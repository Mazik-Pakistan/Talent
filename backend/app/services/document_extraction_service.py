import os
import re
import json
import logging
import tempfile
from pathlib import Path
import httpx

from app.core.config import settings

logger = logging.getLogger("document_extraction_service")

# Regex heuristics patterns for fallback extraction
CNIC_PATTERN = re.compile(r"\b\d{5}-?\d{7}-?\d{1}\b")
PASSPORT_PATTERN = re.compile(r"\b[A-Z]{1,2}\d{6,8}\b")
EMAIL_PATTERN = re.compile(r"[\w\.-]+@[\w\.-]+\.\w+")
PHONE_PATTERN = re.compile(r"\b(?:\+?92|0)?3\d{2}[- ]?\d{7}\b")
DATE_PATTERN = re.compile(r"\b(\d{1,2}[-/ ]\d{1,2}[-/ ]\d{2,4}|\d{4}[-/ ]\d{1,2}[-/ ]\d{1,2})\b")

class DocumentExtractionService:
    def __init__(self):
        self._easyocr_reader = None

    def _get_easyocr_reader(self):
        """Lazily initialize EasyOCR Reader."""
        if self._easyocr_reader is None:
            try:
                import easyocr
                # Disable downloading logs, download model automatically if missing
                self._easyocr_reader = easyocr.Reader(['en'], gpu=False)
            except Exception as e:
                logger.error(f"Failed to initialize EasyOCR: {e}")
        return self._easyocr_reader

    def detect_file_type(self, file_path: str) -> str:
        """Detect file type based on extension."""
        ext = Path(file_path).suffix.lower()
        if ext in (".png", ".jpg", ".jpeg"):
            return "image"
        elif ext == ".pdf":
            return "pdf"
        elif ext in (".doc", ".docx"):
            return "docx"
        elif ext in (".txt", ".log", ".json", ".csv"):
            return "txt"
        return "unknown"

    def extract_text_from_txt(self, file_path: str) -> str:
        """Read text files directly."""
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except UnicodeDecodeError:
            with open(file_path, "r", encoding="latin-1") as f:
                return f.read()

    def extract_text_from_docx(self, file_path: str) -> str:
        """Extract text from Word DOCX file."""
        import docx
        doc = docx.Document(file_path)
        parts = []
        for p in doc.paragraphs:
            if p.text.strip():
                parts.append(p.text)
        for table in doc.tables:
            for row in table.rows:
                cells = [c.text.strip() for c in row.cells if c.text.strip()]
                if cells:
                    parts.append(" | ".join(cells))
        return "\n".join(parts)

    def extract_text_from_image(self, file_path: str) -> str:
        """Extract text from image using EasyOCR, fallback to pytesseract."""
        reader = self._get_easyocr_reader()
        extracted_lines = []
        if reader:
            try:
                results = reader.readtext(file_path, detail=0)
                if results:
                    extracted_lines = results
            except Exception as e:
                logger.error(f"EasyOCR extraction failed: {e}")

        text = "\n".join(extracted_lines)
        if text.strip():
            return text

        # Fallback to pytesseract
        logger.info("Falling back to pytesseract for image OCR")
        try:
            import pytesseract
            from PIL import Image
            tess_text = pytesseract.image_to_string(Image.open(file_path))
            if tess_text.strip():
                return tess_text
        except Exception as e:
            logger.error(f"Pytesseract fallback failed: {e}")

        return text

    def extract_text_from_pdf(self, file_path: str) -> str:
        """Extract text from PDF (digital or scanned)."""
        import fitz
        doc = fitz.open(file_path)
        text_parts = []
        is_scanned = True

        for page in doc:
            page_text = page.get_text()
            if page_text.strip():
                text_parts.append(page_text)
                is_scanned = False

        if not is_scanned:
            doc.close()
            return "\n".join(text_parts)

        # Scanned PDF processing: rasterize pages to images and run OCR
        logger.info(f"PDF {file_path} appears to be scanned. Rasterizing pages...")
        reader = self._get_easyocr_reader()
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            pix = page.get_pixmap(dpi=150)
            
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                tmp_name = tmp.name
            
            try:
                pix.save(tmp_name)
                page_text = ""
                if reader:
                    try:
                        results = reader.readtext(tmp_name, detail=0)
                        page_text = " ".join(results)
                    except Exception as e:
                        logger.error(f"EasyOCR on PDF page {page_num} failed: {e}")
                
                if not page_text.strip():
                    try:
                        import pytesseract
                        from PIL import Image
                        page_text = pytesseract.image_to_string(Image.open(tmp_name))
                    except Exception as e:
                        logger.error(f"Pytesseract fallback on PDF page {page_num} failed: {e}")

                if page_text.strip():
                    text_parts.append(page_text)
            finally:
                if os.path.exists(tmp_name):
                    try:
                        os.unlink(tmp_name)
                    except OSError:
                        pass
        
        doc.close()
        return "\n".join(text_parts)

    def extract_text(self, file_path: str) -> str:
        """Automatically detect file type and extract text."""
        file_type = self.detect_file_type(file_path)
        if file_type == "pdf":
            return self.extract_text_from_pdf(file_path)
        elif file_type == "docx":
            return self.extract_text_from_docx(file_path)
        elif file_type == "txt":
            return self.extract_text_from_txt(file_path)
        elif file_type == "image":
            return self.extract_text_from_image(file_path)
        return ""

    async def parse_structured_data(self, raw_text: str) -> dict:
        """Parse structured fields using Gemini API, degrading to heuristics."""
        if not raw_text.strip():
            return {"category": "unknown", "fields": {}}

        # Attempt to call Gemini API if key is present
        if settings.GEMINI_API_KEY and not settings.GEMINI_API_KEY.startswith("YOUR_"):
            try:
                # We will call Gemini 1.5 Flash using direct HTTP API
                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={settings.GEMINI_API_KEY}"
                
                prompt = f"""
You are an expert document information extractor. Analyze the document text provided below.
First, classify the document into one of these categories:
- "resume" (Resume, CV)
- "cnic" (Pakistan National Identity Card / CNIC)
- "passport" (Passport page)
- "payroll" (Payroll Documents, Salary slip, Pay slip)
- "certificate" (Academic Degree, Completion Certificate)
- "invoice" (Invoice, Vendor bill)
- "unknown" (Any other document type)

Based on the classification, extract the specified fields. If a field cannot be found, set its value to null. Do not include fields from other categories.

Category specific fields to extract:
1. For "resume":
   - "full_name"
   - "email"
   - "phone_number"
   - "address"
   - "skills" (list of strings)
   - "education" (list of strings or summarizing text)
   - "experience" (list of strings or summarizing text)
   - "certifications" (list of strings)
   - "linkedin"
   - "github"
2. For "cnic":
   - "name"
   - "father_name"
   - "cnic_number"
   - "date_of_birth"
   - "gender"
   - "issue_date"
   - "expiry_date"
3. For "passport":
   - "passport_number"
   - "name"
   - "nationality"
   - "date_of_birth"
   - "expiry_date"
4. For "payroll":
   - "employee_name"
   - "employee_id"
   - "salary" (number or string)
   - "allowances" (number or string)
   - "deductions" (number or string)
   - "tax" (number or string)
   - "net_salary" (number or string)
   - "pay_period" (string)
5. For "certificate":
   - "candidate_name"
   - "institute"
   - "degree"
   - "completion_date"
6. For "invoice":
   - "invoice_number"
   - "vendor"
   - "date"
   - "amount" (number or string)
   - "tax" (number or string)

Output must be in JSON format matching this schema:
{{
  "category": "resume" | "cnic" | "passport" | "payroll" | "certificate" | "invoice" | "unknown",
  "fields": {{ ...category specific fields... }}
}}

Document Text:
{raw_text}
"""

                payload = {
                    "contents": [{
                        "parts": [{
                            "text": prompt
                        }]
                    }],
                    "generationConfig": {
                        "responseMimeType": "application/json"
                    }
                }
                
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(url, json=payload)
                    if response.status_code == 200:
                        res_json = response.json()
                        text_response = res_json["candidates"][0]["content"]["parts"][0]["text"]
                        parsed = json.loads(text_response.strip())
                        if "category" in parsed and "fields" in parsed:
                            return parsed

            except Exception as e:
                logger.error(f"Gemini API parse failed: {e}. Falling back to heuristics.")

        # Heuristic fallback if Gemini is unavailable
        return self._heuristic_fallback_parse(raw_text)

    def _heuristic_fallback_parse(self, text: str) -> dict:
        """Extract information using regex/heuristics."""
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        
        cnic_match = CNIC_PATTERN.search(text)
        passport_match = PASSPORT_PATTERN.search(text)
        email_match = EMAIL_PATTERN.search(text)
        phone_match = PHONE_PATTERN.search(text)
        dates = DATE_PATTERN.findall(text)

        # Basic classification heuristics
        if cnic_match:
            category = "cnic"
            fields = {
                "cnic_number": cnic_match.group(0),
                "name": lines[0] if lines else None,
                "date_of_birth": dates[0] if len(dates) > 0 else None,
                "gender": "Male" if "male" in text.lower() else "Female" if "female" in text.lower() else None,
            }
        elif passport_match:
            category = "passport"
            fields = {
                "passport_number": passport_match.group(0),
                "name": lines[0] if lines else None,
                "nationality": "Pakistani" if "pakistan" in text.lower() else None,
                "date_of_birth": dates[0] if len(dates) > 0 else None,
            }
        elif email_match or "experience" in text.lower() or "skills" in text.lower():
            category = "resume"
            fields = {
                "email": email_match.group(0) if email_match else None,
                "phone_number": phone_match.group(0) if phone_match else None,
                "full_name": lines[0] if lines else None,
                "address": None,
                "skills": [],
                "education": None,
                "experience": None,
            }
        elif "salary" in text.lower() or "pay slip" in text.lower() or "payroll" in text.lower():
            category = "payroll"
            fields = {
                "employee_name": None,
                "employee_id": None,
                "salary": None,
                "net_salary": None,
            }
        elif "degree" in text.lower() or "certificate" in text.lower() or "university" in text.lower():
            category = "certificate"
            fields = {
                "candidate_name": lines[0] if lines else None,
                "institute": next((l for l in lines if "university" in l.lower() or "college" in l.lower()), None),
                "degree": next((l for l in lines if "bachelor" in l.lower() or "master" in l.lower() or "degree" in l.lower()), None),
                "completion_date": dates[-1] if dates else None,
            }
        elif "invoice" in text.lower() or "bill" in text.lower() or "tax invoice" in text.lower():
            category = "invoice"
            fields = {
                "invoice_number": None,
                "vendor": None,
                "date": dates[0] if dates else None,
                "amount": None,
            }
        else:
            category = "unknown"
            fields = {}

        return {"category": category, "fields": fields}

document_extraction_service = DocumentExtractionService()
