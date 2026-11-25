"""AI_MODEL=fake: an offline, deterministic stand-in for a real LLM.

It is a Pydantic AI FunctionModel, so it goes through exactly the same agent, tool call,
output validation and error handling as a real model: it first calls list_my_tropes,
then answers with a SearchPlan built from keyword rules.

Used for: e2e tests and CI (no key, no network, same answer every time), running the
demo without a key, and as the keyword baseline in the eval (eval/). It is NOT smart:
it only understands the phrasings below.
"""

import re

from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.schemas import trope_key

GENRE_WORDS: list[tuple[str, str]] = [
    (r"\bsci[- ]?fi\b|\bscience fiction\b|\bsf\b|\bspace opera\b", "Sci-Fi"),
    (r"\bnon[- ]?fiction\b|\bmemoirs?\b|\bbiograph", "Non-Fiction"),
    (r"\bhistorical\b", "Historical"),
    (r"\bfantasy\b", "Fantasy"),
    (r"\bromance\b|\bromantic\b|\blove stor", "Romance"),
    (r"\bthrillers?\b", "Thriller"),
    (r"\bmyster(y|ies)\b|\bwhodunits?\b|\bdetective\b|\bcrime\b", "Mystery"),
]
UNREAD = (
    r"\bunread\b|\bhaven'?t read\b|\bnot (yet )?read\b|\bto[- ]be[- ]read\b|\btbr\b|\bnot started\b"
)
READ = r"\bi'?ve read\b|\balready read\b|\bfinished\b|\bi read\b|\bread\b"
RATINGS: list[tuple[str, int]] = [
    (r"\b(5|five)[- ]stars?\b", 5),
    (r"\b(4|four)[- ]stars?\b|\bat least (4|four)\b", 4),
    (r"\b(3|three)[- ]stars?\b|\bat least (3|three)\b", 3),
    (r"\b(2|two)[- ]stars?\b", 2),
    (r"\bfavou?rites?\b|\bloved\b|\bbest\b|\bhighly rated\b|\btop[- ]rated\b", 4),
]
# "books by Ursula Le Guin" -> "Ursula Le Guin" (up to a comma or a filter word).
BY_AUTHOR = re.compile(
    r"\bby ([a-z][\w.' -]*?)(?=,|\.|\?|$| that | which | with | i | rated | unread| read)",
    re.IGNORECASE,
)


def keyword_plan(question: str, tropes: list[str]) -> dict[str, object]:
    q = question.lower()
    plan: dict[str, object] = {}
    for pattern, genre in GENRE_WORDS:
        if re.search(pattern, q):
            plan["genre"] = genre
            break
    if re.search(UNREAD, q):
        plan["read_status"] = "unread"
    elif re.search(READ, q):
        plan["read_status"] = "read"
    for pattern, rating in RATINGS:
        if re.search(pattern, q):
            plan["min_rating"] = rating
            break
    # The longest of the reader's tropes that appears in the question.
    q_key = f" {trope_key(q)} "
    found = [t for t in tropes if f" {trope_key(t)} " in q_key]
    if found:
        plan["trope"] = max(found, key=len)
    if match := BY_AUTHOR.search(question):
        plan["text"] = match.group(1).strip()
    described = ", ".join(f"{k}={v}" for k, v in plan.items()) or "no filters"
    plan["explanation"] = f"Keyword match (offline fake model): {described}."
    return plan


def _question(messages: list[ModelMessage]) -> str:
    for message in messages:
        for part in message.parts:
            if isinstance(part, UserPromptPart) and isinstance(part.content, str):
                return part.content
    return ""  # pragma: no cover  (the agent always sends the question first)


def _tropes(messages: list[ModelMessage]) -> list[str] | None:
    for message in messages:
        for part in message.parts:
            if isinstance(part, ToolReturnPart) and part.tool_name == "list_my_tropes":
                return [str(t) for t in part.content]  # type: ignore[union-attr]
    return None


def _respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    tropes = _tropes(messages)
    if tropes is None:  # first turn: look up the reader's tropes, like a real model would
        return ModelResponse(parts=[ToolCallPart("list_my_tropes", {})])
    plan = keyword_plan(_question(messages), tropes)
    return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, plan)])


def fake_model() -> FunctionModel:
    return FunctionModel(_respond, model_name="fake-keywords")
