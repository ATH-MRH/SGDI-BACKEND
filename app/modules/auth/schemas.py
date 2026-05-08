from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    email: EmailStr | None = None
    full_name: str = Field(min_length=2, max_length=150)
    role: str = "admin"
    password: str = Field(min_length=4)


class UserOut(BaseModel):
    id: int
    username: str
    email: str | None
    full_name: str
    role: str
    is_active: bool

    model_config = {"from_attributes": True}


class LoginIn(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

