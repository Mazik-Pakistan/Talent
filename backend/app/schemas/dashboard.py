from pydantic import BaseModel, Field, model_validator


class MarkNotificationsReadRequest(BaseModel):
    """US-014: mark one/many notifications as read, or all of them."""

    ids: list[str] = Field(default_factory=list)
    all: bool = False

    @model_validator(mode="after")
    def require_target(self):
        if not self.all and not self.ids:
            raise ValueError("Provide notification ids or set all=true.")
        return self


class CreateAnnouncementRequest(BaseModel):
    """US-020: recruiters publish onboarding announcements visible to candidates."""

    title: str = Field(min_length=3, max_length=150)
    body: str = Field(min_length=3, max_length=4000)

    @model_validator(mode="after")
    def normalize(self):
        self.title = " ".join(self.title.split())
        self.body = self.body.strip()
        return self