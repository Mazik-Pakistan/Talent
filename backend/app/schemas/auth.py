from pydantic import BaseModel, EmailStr


class RegisterRequest(BaseModel):

    full_name: str

    email: EmailStr

    phone: str

    password: str