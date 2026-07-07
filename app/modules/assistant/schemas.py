from pydantic import BaseModel, Field


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[Message] = Field(default_factory=list)
    context: dict | None = None


class ChatResponse(BaseModel):
    response: str


class AgentRequest(BaseModel):
    message: str
    history: list[Message] = Field(default_factory=list)


class AgentResponse(BaseModel):
    response: str
