from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://workspace:workspace@localhost:5432/workspace"
    jwt_secret: str = "CAMBIAMI-con-una-stringa-lunga-e-casuale"
    jwt_days: int = 30
    allow_signup: bool = True  # dopo aver creato il tuo account mettilo a false
    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"  # alias sempre aggiornato da Google
    gemini_embed_model: str = "gemini-embedding-001"
    embed_dim: int = 768
    max_upload_mb: int = 20
    cors_origins: str = "*"  # es. "https://app.tuodominio.it"
    static_dir: str = "static"  # frontend compilato servito dallo stesso server


settings = Settings()

# Neon/Render forniscono "postgres://" o "postgresql://": lo adattiamo a psycopg 3
if settings.database_url.startswith("postgres://"):
    settings.database_url = settings.database_url.replace("postgres://", "postgresql+psycopg://", 1)
elif settings.database_url.startswith("postgresql://"):
    settings.database_url = settings.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
