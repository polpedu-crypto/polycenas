from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    database_url: str = Field(
        default="postgresql://localhost:5432/polymarket",
        validation_alias="DATABASE_URL",
    )
    vertex_api_key: str = Field(
        default="",
        validation_alias="VERTEX_API_KEY",
    )

    # BERTopic clustering
    embedding_model: str = Field(
        default="all-MiniLM-L6-v2",
        validation_alias="EMBEDDING_MODEL",
    )
    min_cluster_size: int = Field(
        default=3,
        description="Min event groups per BERTopic cluster",
        validation_alias="MIN_CLUSTER_SIZE",
    )
    max_cluster_size: int = Field(
        default=10,
        description="Max markets per cluster before splitting",
        validation_alias="MAX_CLUSTER_SIZE",
    )
    max_markets: int = Field(
        default=5000,
        description="Max markets to fetch for clustering (0 = no limit)",
        validation_alias="MAX_MARKETS",
    )

    # LLM naming
    naming_model: str = Field(
        default="gemini-2.5-flash",
        validation_alias="NAMING_MODEL",
    )

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
