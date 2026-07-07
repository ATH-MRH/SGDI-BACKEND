from pydantic import BaseModel, EmailStr, Field, model_validator


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=150)
    role: str = "admin"
    access_level: str | None = Field(default=None, max_length=40)
    authorized_societies: list[str] = Field(default_factory=list)
    authorized_structures: list[str] = Field(default_factory=list)
    authorized_sites: list[int] = Field(default_factory=list)
    password: str = Field(min_length=4)

    @model_validator(mode="after")
    def normalize_full_name(self):
        if not self.full_name:
            self.full_name = self.username
        return self


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=150)
    role: str | None = None
    access_level: str | None = Field(default=None, max_length=40)
    authorized_societies: list[str] | None = None
    authorized_structures: list[str] | None = None
    authorized_sites: list[int] | None = None
    password: str | None = Field(default=None, min_length=4)
    is_active: bool | None = None


class AccessRuleIn(BaseModel):
    module_key: str = Field(min_length=1, max_length=80)
    role: str = Field(min_length=1, max_length=40)
    allowed: bool


class AccessRuleOut(BaseModel):
    module_key: str
    role: str
    allowed: bool

    model_config = {"from_attributes": True}


class UserOut(BaseModel):
    id: int
    username: str
    email: str | None
    full_name: str
    role: str
    access_level: str | None = None
    authorized_societies: list[str] | None = Field(default_factory=list)
    authorized_structures: list[str] | None = Field(default_factory=list)
    authorized_sites: list[int] | None = Field(default_factory=list)
    is_active: bool

    model_config = {"from_attributes": True}


class LoginIn(BaseModel):
    username: str
    password: str


class AdminSystemLoginIn(BaseModel):
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

