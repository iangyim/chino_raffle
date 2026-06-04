import random
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class RaffleRequest(BaseModel):
    names: list[str]


class RaffleResponse(BaseModel):
    winner: str


@app.post("/api/raffle", response_model=RaffleResponse)
def pick_winner(req: RaffleRequest):
    names = [n.strip() for n in req.names if n.strip()]
    if len(names) < 1:
        raise HTTPException(status_code=400, detail="At least one name required")
    return RaffleResponse(winner=random.choice(names))
