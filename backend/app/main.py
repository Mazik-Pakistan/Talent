from fastapi import FastAPI

app = FastAPI(
    title="Talent API",
    version="1.0.0"
)

@app.get("/")
async def root():
    return {"message": "Talent Backend Running"}