from typing import Literal

from pydantic import BaseModel, EmailStr, Field, model_validator


UserAction = Literal["read", "create", "update", "validate", "delete", "export", "unlock", "admin"]


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=150)
    role: str = "admin"
    access_level: str | None = Field(default=None, max_length=40)
    authorized_societies: list[str] = Field(default_factory=list)
    authorized_structures: list[str] = Field(default_factory=list)
    authorized_sites: list[int] = Field(default_factory=list)
    authorized_actions: list[UserAction] = Field(default_factory=list)
    authorized_modules: list[str] = Field(default_factory=list)
    supervisor_read_only: bool = True
    global_society_access: bool = False
    password: str = Field(min_length=4)
    validation_password: str | None = Field(default=None, min_length=4)

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
    authorized_actions: list[UserAction] | None = None
    authorized_modules: list[str] | None = None
    supervisor_read_only: bool | None = None
    global_society_access: bool | None = None
    password: str | None = Field(default=None, min_length=4)
    validation_password: str | None = Field(default=None, min_length=4)
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


class ModulePermissionIn(BaseModel):
    module_key: str = Field(min_length=1, max_length=80)
    action_key: str = Field(min_length=1, max_length=40)


class ModulePermissionsReplaceIn(BaseModel):
    permissions: list[ModulePermissionIn] = Field(default_factory=list)


class ModulePermissionOut(BaseModel):
    module_key: str
    action_key: str


class ModulePermissionCatalogOut(BaseModel):
    modules: list[str]
    actions: list[str]


class UserModulePermissionsOut(BaseModel):
    user_id: int
    username: str
    permissions: list[ModulePermissionOut]
    permission_count: int
    granular_permissions_active: bool = False
    legacy_permissions_active: bool = True
    authorized_societies: list[str] | None = None
    authorized_sites: list[int] | None = None


class FeaturePermissionIn(BaseModel):
    module_key: str = Field(min_length=1, max_length=80)
    feature_key: str = Field(min_length=1, max_length=100)
    action_key: str = Field(min_length=1, max_length=40)


class FeaturePermissionsReplaceIn(BaseModel):
    permissions: list[FeaturePermissionIn] = Field(default_factory=list)


class FeaturePermissionOut(BaseModel):
    module_key: str
    feature_key: str
    action_key: str


class FeatureCatalogItemOut(BaseModel):
    feature_key: str
    label: str
    description: str
    applicable_actions: list[str]


class FeatureCatalogModuleOut(BaseModel):
    module_key: str
    label: str
    domain: str
    description: str
    features: list[FeatureCatalogItemOut]


class FeaturePermissionCatalogOut(BaseModel):
    modules: list[FeatureCatalogModuleOut]
    actions: list[str]
    granular_permissions_active: bool = False


class UserFeaturePermissionsOut(BaseModel):
    user_id: int
    username: str
    permissions: list[FeaturePermissionOut]
    permission_count: int
    granular_permissions_active: bool = False
    legacy_permissions_active: bool = True
    authorized_societies: list[str] | None = None
    authorized_sites: list[int] | None = None


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
    authorized_actions: list[UserAction] | None = Field(default_factory=list)
    authorized_modules: list[str] | None = None
    supervisor_read_only: bool = True
    global_society_access: bool = False
    has_validation_password: bool = False
    credentials_email_sent: bool = False
    credentials_email_error: str | None = None
    is_active: bool

    model_config = {"from_attributes": True}


class LoginIn(BaseModel):
    username: str
    password: str


class AdminSystemLoginIn(BaseModel):
    username: str | None = None
    password: str


class AdminRecoveryIn(BaseModel):
    username: str
    recovery_secret: str
    new_password: str = Field(min_length=12)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
