from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import Project, User

bearer = HTTPBearer(auto_error=False)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt()).decode()


def check_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode()[:72], hashed.encode())
    except ValueError:
        return False


def make_token(user_id: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=settings.jwt_days)
    return jwt.encode({"sub": str(user_id), "exp": exp}, settings.jwt_secret, algorithm="HS256")


def current_user(
    cred: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)
) -> User:
    if not cred:
        raise HTTPException(401, "Accesso richiesto")
    try:
        data = jwt.decode(cred.credentials, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Sessione scaduta, accedi di nuovo")
    user = db.get(User, int(data["sub"]))
    if not user:
        raise HTTPException(401, "Utente non trovato")
    return user


def own_project(project_id: int, user: User, db: Session) -> Project:
    p = db.get(Project, project_id)
    if not p or p.user_id != user.id:
        raise HTTPException(404, "Progetto non trovato")
    return p
