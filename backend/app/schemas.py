from pydantic import BaseModel

class ChatRequest(BaseModel):
    message: str
    chat_id: str = "default"
    mode: str = "auto"
    response_length: str = "medium"
    safe_mode: bool = True

class ChatResponse(BaseModel):
    reply: str

class CodeRunRequest(BaseModel):
    code: str
    language: str | None = None
