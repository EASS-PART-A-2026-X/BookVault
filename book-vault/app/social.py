"""Social features: find people, view profiles and reviews, follow, follow requests.

Visibility rule (the only place it is decided: `can_view_books`): you can see someone's
books and reviews if it's you, if their profile is public, or if you follow them and
they accepted. Everyone logged in can see a profile's name, bio and counts.

Following a public profile takes effect at once. Following a private one creates a
pending request the other person accepts or declines. Making a profile public accepts
every pending request.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.auth import UNAUTHORIZED_RESPONSE, current_user
from app.database import get_db
from app.models import Book, Follow, User
from app.schemas import (
    BookRead,
    ErrorResponse,
    FollowRequestRead,
    FollowResult,
    FollowStatus,
    ProfileRead,
    ProfileUpdate,
    UserRead,
    UserSummary,
)

USER_NOT_FOUND = "User not found"
PROFILE_PRIVATE = "This profile is private"
CANNOT_FOLLOW_SELF = "You can't follow yourself"
REQUEST_NOT_FOUND = "Follow request not found"

PENDING = "pending"
ACCEPTED = "accepted"
SEARCH_LIMIT = 20

USER_RESPONSES = {
    **UNAUTHORIZED_RESPONSE,
    status.HTTP_404_NOT_FOUND: {"model": ErrorResponse, "description": USER_NOT_FOUND},
}
PRIVATE_RESPONSES = {
    **USER_RESPONSES,
    status.HTTP_403_FORBIDDEN: {"model": ErrorResponse, "description": PROFILE_PRIVATE},
}

router = APIRouter(tags=["social"])


# ------------------------------------------------------------------- helpers


def get_user_or_404(db: Session, username: str) -> User:
    user = db.scalar(select(User).where(User.username == username.strip().lower()))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=USER_NOT_FOUND)
    return user


def get_follow(db: Session, follower: User, followee: User) -> Follow | None:
    return db.scalar(
        select(Follow).where(Follow.follower_id == follower.id, Follow.followee_id == followee.id)
    )


def follow_status(db: Session, viewer: User, other: User) -> FollowStatus:
    if viewer.id == other.id:
        return "self"
    follow = get_follow(db, viewer, other)
    if follow is None:
        return "none"
    return "following" if follow.status == ACCEPTED else "requested"


def can_view_books(db: Session, viewer: User, owner: User) -> bool:
    return (
        viewer.id == owner.id or owner.is_public or follow_status(db, viewer, owner) == "following"
    )


def summary(db: Session, viewer: User, user: User) -> UserSummary:
    return UserSummary(
        username=user.username,
        display_name=user.display_name,
        is_public=user.is_public,
        follow_status=follow_status(db, viewer, user),
    )


def accepted_count(db: Session, column: object, user_id: int) -> int:
    return (
        db.scalar(select(func.count(Follow.id)).where(column == user_id, Follow.status == ACCEPTED))
        or 0
    )


def accept_pending_requests(db: Session, user: User) -> None:
    """Called when a profile goes public: nobody needs approval any more."""
    for follow in db.scalars(
        select(Follow).where(Follow.followee_id == user.id, Follow.status == PENDING)
    ):
        follow.status = ACCEPTED


# --------------------------------------------------------------- your profile


@router.patch("/users/me", response_model=UserRead, responses=UNAUTHORIZED_RESPONSE)
def update_me(
    payload: ProfileUpdate,
    viewer: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> User:
    """Change your display name, bio or public/private setting. Going public accepts
    every pending follow request."""
    changes = payload.model_dump(exclude_unset=True)
    going_public = changes.get("is_public") is True and not viewer.is_public
    for field, value in changes.items():
        setattr(viewer, field, value)
    if going_public:
        accept_pending_requests(db, viewer)
    db.commit()
    db.refresh(viewer)
    return viewer


# ------------------------------------------------------------------ search


@router.get("/users", response_model=list[UserSummary], responses=UNAUTHORIZED_RESPONSE)
def search_users(
    q: str = Query(min_length=1, max_length=50, description="Part of a username or display name"),
    viewer: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[UserSummary]:
    """Find people by username or display name (case-insensitive), best matches first:
    exact username, then usernames starting with the text, then everything else."""
    text = q.strip().lower()
    if not text:
        return []
    # Escape LIKE wildcards so "%" and "_" match literally.
    pattern = "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    users = db.scalars(
        select(User)
        .where(
            or_(
                User.username.like(pattern, escape="\\"),
                func.lower(User.display_name).like(pattern, escape="\\"),
            )
        )
        .order_by(
            (User.username != text),
            ~User.username.startswith(text, autoescape=True),
            User.username,
        )
        .limit(SEARCH_LIMIT)
    )
    return [summary(db, viewer, user) for user in users]


# ---------------------------------------------------------------- profiles


@router.get("/users/{username}", response_model=ProfileRead, responses=USER_RESPONSES)
def get_profile(
    username: str, viewer: User = Depends(current_user), db: Session = Depends(get_db)
) -> ProfileRead:
    user = get_user_or_404(db, username)
    reverse = get_follow(db, user, viewer)
    return ProfileRead(
        **summary(db, viewer, user).model_dump(),
        bio=user.bio,
        created_at=user.created_at,
        book_count=db.scalar(select(func.count(Book.id)).where(Book.owner_id == user.id)) or 0,
        follower_count=accepted_count(db, Follow.followee_id, user.id),
        following_count=accepted_count(db, Follow.follower_id, user.id),
        can_view_books=can_view_books(db, viewer, user),
        follows_you=reverse is not None and reverse.status == ACCEPTED,
    )


@router.get("/users/{username}/books", response_model=list[BookRead], responses=PRIVATE_RESPONSES)
def get_user_books(
    username: str, viewer: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[Book]:
    """Someone's books and reviews, most recently updated first (403 if private)."""
    user = get_user_or_404(db, username)
    if not can_view_books(db, viewer, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=PROFILE_PRIVATE)
    return list(
        db.scalars(
            select(Book)
            .where(Book.owner_id == user.id)
            .order_by(Book.updated_at.desc(), Book.id.desc())
        )
    )


def _people(db: Session, viewer: User, user: User, *, followers: bool) -> list[UserSummary]:
    """Accepted followers of `user`, or the people `user` follows (403 if private)."""
    if not can_view_books(db, viewer, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=PROFILE_PRIVATE)
    side = Follow.followee_id if followers else Follow.follower_id
    follows = db.scalars(
        select(Follow).where(side == user.id, Follow.status == ACCEPTED).order_by(Follow.created_at)
    )
    return [summary(db, viewer, f.follower if followers else f.followee) for f in follows]


@router.get(
    "/users/{username}/followers", response_model=list[UserSummary], responses=PRIVATE_RESPONSES
)
def get_followers(
    username: str, viewer: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[UserSummary]:
    return _people(db, viewer, get_user_or_404(db, username), followers=True)


@router.get(
    "/users/{username}/following", response_model=list[UserSummary], responses=PRIVATE_RESPONSES
)
def get_following(
    username: str, viewer: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[UserSummary]:
    return _people(db, viewer, get_user_or_404(db, username), followers=False)


# ------------------------------------------------------------------- follow


@router.post(
    "/users/{username}/follow",
    response_model=FollowResult,
    responses={
        **USER_RESPONSES,
        status.HTTP_400_BAD_REQUEST: {"model": ErrorResponse, "description": CANNOT_FOLLOW_SELF},
    },
)
def follow(
    username: str, viewer: User = Depends(current_user), db: Session = Depends(get_db)
) -> FollowResult:
    """Follow someone: instant for public profiles, a request for private ones.
    Calling it again changes nothing."""
    user = get_user_or_404(db, username)
    if user.id == viewer.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=CANNOT_FOLLOW_SELF)
    if get_follow(db, viewer, user) is None:
        db.add(
            Follow(
                follower_id=viewer.id,
                followee_id=user.id,
                status=ACCEPTED if user.is_public else PENDING,
            )
        )
        db.commit()
    return FollowResult(follow_status=follow_status(db, viewer, user))


@router.delete(
    "/users/{username}/follow", status_code=status.HTTP_204_NO_CONTENT, responses=USER_RESPONSES
)
def unfollow(
    username: str, viewer: User = Depends(current_user), db: Session = Depends(get_db)
) -> Response:
    """Unfollow, or cancel a pending request. Fine to call when not following."""
    user = get_user_or_404(db, username)
    existing = get_follow(db, viewer, user)
    if existing is not None:
        db.delete(existing)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/users/me/followers/{username}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=USER_RESPONSES,
)
def remove_follower(
    username: str, viewer: User = Depends(current_user), db: Session = Depends(get_db)
) -> Response:
    """Remove someone from your followers (they lose access to a private profile)."""
    user = get_user_or_404(db, username)
    existing = get_follow(db, user, viewer)
    if existing is not None:
        db.delete(existing)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------- follow requests


@router.get(
    "/follow-requests", response_model=list[FollowRequestRead], responses=UNAUTHORIZED_RESPONSE
)
def list_follow_requests(
    viewer: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[FollowRequestRead]:
    """People waiting for you to accept them, oldest first."""
    pending = db.scalars(
        select(Follow)
        .where(Follow.followee_id == viewer.id, Follow.status == PENDING)
        .order_by(Follow.created_at, Follow.id)
    )
    return [
        FollowRequestRead(
            username=f.follower.username,
            display_name=f.follower.display_name,
            requested_at=f.created_at,
        )
        for f in pending
    ]


def _pending_from(db: Session, viewer: User, username: str) -> Follow:
    requester = get_user_or_404(db, username)
    follow = get_follow(db, requester, viewer)
    if follow is None or follow.status != PENDING:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=REQUEST_NOT_FOUND)
    return follow


@router.post(
    "/follow-requests/{username}/accept",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=USER_RESPONSES,
)
def accept_request(
    username: str, viewer: User = Depends(current_user), db: Session = Depends(get_db)
) -> Response:
    _pending_from(db, viewer, username).status = ACCEPTED
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/follow-requests/{username}/decline",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=USER_RESPONSES,
)
def decline_request(
    username: str, viewer: User = Depends(current_user), db: Session = Depends(get_db)
) -> Response:
    db.delete(_pending_from(db, viewer, username))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
