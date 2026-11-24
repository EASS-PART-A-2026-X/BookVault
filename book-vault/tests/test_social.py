"""Social: search, profiles, follow / follow requests, and who can see whose books."""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

MakeClient = Callable[..., TestClient]
BOOK: dict[str, Any] = {
    "title": "Emma",
    "author": "Jane Austen",
    "genre": "Romance",
    "rating": 4,
    "review": "Meddling, but charming.",
    "tropes": ["matchmaking"],
}


def make_public(client: TestClient) -> None:
    assert client.patch("/users/me", json={"is_public": True}).status_code == 200


def usernames(response: Any) -> list[str]:
    return [u["username"] for u in response.json()]


# ------------------------------------------------------------------------ Search


def test_search_matches_username_and_display_name(make_client: MakeClient) -> None:
    alice = make_client("alice")
    make_client("alicia")
    bob = make_client("bob")
    bob.patch("/users/me", json={"display_name": "Bob Alison"})
    make_client("carol")

    assert usernames(alice.get("/users", params={"q": "ali"})) == ["alice", "alicia", "bob"]
    assert usernames(alice.get("/users", params={"q": "ALISON"})) == ["bob"]
    assert alice.get("/users", params={"q": "zzz"}).json() == []


def test_search_ranks_exact_then_prefix_matches_first(make_client: MakeClient) -> None:
    viewer = make_client("viewer")
    for name in ("xann", "ann_b", "ann"):
        make_client(name)
    assert usernames(viewer.get("/users", params={"q": "ann"})) == ["ann", "ann_b", "xann"]


def test_search_treats_wildcards_literally(make_client: MakeClient) -> None:
    viewer = make_client("viewer")
    make_client("a_b")
    make_client("axb")
    assert usernames(viewer.get("/users", params={"q": "a_b"})) == ["a_b"]
    assert viewer.get("/users", params={"q": "%"}).json() == []


def test_search_reports_follow_status(make_client: MakeClient) -> None:
    viewer = make_client("viewer")
    make_public(make_client("pub_ann"))
    make_client("priv_ann")
    viewer.post("/users/pub_ann/follow")
    viewer.post("/users/priv_ann/follow")
    results = {u["username"]: u for u in viewer.get("/users", params={"q": "ann"}).json()}
    assert results["pub_ann"]["follow_status"] == "following"
    assert results["priv_ann"]["follow_status"] == "requested"
    assert results["priv_ann"]["is_public"] is False
    assert "bio" not in results["pub_ann"] and "password_hash" not in str(results)


@pytest.mark.parametrize("q", ["", "x" * 51])
def test_search_validation(client: TestClient, q: str) -> None:
    assert client.get("/users", params={"q": q}).status_code == 422


def test_search_blank_after_trim_returns_nothing(client: TestClient) -> None:
    assert client.get("/users", params={"q": "   "}).json() == []


# ----------------------------------------------------------------------- Profiles


def test_private_profile_shows_name_bio_counts_but_not_books(make_client: MakeClient) -> None:
    alice, bob = make_client("alice"), make_client("bob")
    alice.patch("/users/me", json={"display_name": "Alice A.", "bio": "Regency romance"})
    alice.post("/books", json=BOOK)

    profile = bob.get("/users/Alice").json()  # usernames are case-insensitive
    assert profile | {"created_at": None} == {
        "username": "alice",
        "display_name": "Alice A.",
        "bio": "Regency romance",
        "is_public": False,
        "follow_status": "none",
        "book_count": 1,
        "follower_count": 0,
        "following_count": 0,
        "can_view_books": False,
        "follows_you": False,
        "created_at": None,
    }
    response = bob.get("/users/alice/books")
    assert response.status_code == 403
    assert response.json() == {"detail": "This profile is private"}
    assert bob.get("/users/alice/followers").status_code == 403
    assert bob.get("/users/alice/following").status_code == 403


def test_public_profile_books_and_reviews_are_visible(make_client: MakeClient) -> None:
    alice, bob = make_client("alice"), make_client("bob")
    make_public(alice)
    alice.post("/books", json=BOOK)
    alice.post("/books", json={**BOOK, "title": "Persuasion", "review": None})

    assert bob.get("/users/alice").json()["can_view_books"] is True
    books = bob.get("/users/alice/books").json()
    # Most recently updated first, with reviews and tropes.
    assert [b["title"] for b in books] == ["Persuasion", "Emma"]
    assert books[1]["review"] == "Meddling, but charming."
    assert books[1]["tropes"] == ["matchmaking"]


def test_you_can_always_see_your_own_profile(client: TestClient) -> None:
    client.post("/books", json=BOOK)
    me = client.get("/users/reader").json()
    assert me["follow_status"] == "self" and me["can_view_books"] is True
    assert len(client.get("/users/reader/books").json()) == 1


def test_unknown_user_is_404(client: TestClient) -> None:
    for path in ("/users/ghost", "/users/ghost/books", "/users/ghost/followers"):
        response = client.get(path)
        assert response.status_code == 404
        assert response.json() == {"detail": "User not found"}
    assert client.post("/users/ghost/follow").status_code == 404


@pytest.mark.parametrize("path", ["/users?q=a", "/users/a", "/users/a/books", "/follow-requests"])
def test_social_endpoints_require_login(anon_client: TestClient, path: str) -> None:
    assert anon_client.get(path).status_code == 401


# --------------------------------------------------------------------- Following


def test_following_a_public_profile_is_instant(make_client: MakeClient) -> None:
    alice, bob = make_client("alice"), make_client("bob")
    make_public(alice)

    assert bob.post("/users/alice/follow").json() == {"follow_status": "following"}
    assert alice.get("/follow-requests").json() == []  # no request needed
    assert alice.get("/users/alice").json()["follower_count"] == 1
    assert bob.get("/users/bob").json()["following_count"] == 1
    assert alice.get("/users/bob").json()["follows_you"] is True
    assert usernames(bob.get("/users/alice/followers")) == ["bob"]
    assert usernames(bob.get("/users/bob/following")) == ["alice"]


def test_private_profile_request_then_accept(make_client: MakeClient) -> None:
    alice, bob = make_client("alice"), make_client("bob")
    alice.post("/books", json=BOOK)

    assert bob.post("/users/alice/follow").json() == {"follow_status": "requested"}
    # A pending request grants nothing yet and isn't counted.
    assert bob.get("/users/alice/books").status_code == 403
    assert bob.get("/users/alice").json()["follower_count"] == 0

    requests = alice.get("/follow-requests").json()
    assert [(r["username"], r["display_name"]) for r in requests] == [("bob", "bob")]
    assert alice.post("/follow-requests/bob/accept").status_code == 204

    assert bob.get("/users/alice").json()["follow_status"] == "following"
    assert [b["title"] for b in bob.get("/users/alice/books").json()] == ["Emma"]
    assert alice.get("/follow-requests").json() == []
    # One-way: alice still can't see bob's (private) books.
    assert alice.get("/users/bob/books").status_code == 403


def test_declining_a_request_removes_it(make_client: MakeClient) -> None:
    alice, bob = make_client("alice"), make_client("bob")
    bob.post("/users/alice/follow")
    assert alice.post("/follow-requests/bob/decline").status_code == 204
    assert alice.get("/follow-requests").json() == []
    assert bob.get("/users/alice").json()["follow_status"] == "none"
    # Bob may ask again later.
    assert bob.post("/users/alice/follow").json() == {"follow_status": "requested"}


@pytest.mark.parametrize("action", ["accept", "decline"])
def test_answering_a_missing_request_is_404(make_client: MakeClient, action: str) -> None:
    alice, bob = make_client("alice"), make_client("bob")
    make_public(alice)
    bob.post("/users/alice/follow")  # accepted at once: nothing pending
    response = alice.post(f"/follow-requests/bob/{action}")
    assert response.status_code == 404
    assert response.json() == {"detail": "Follow request not found"}


def test_follow_twice_is_idempotent(make_client: MakeClient) -> None:
    alice, bob = make_client("alice"), make_client("bob")
    bob.post("/users/alice/follow")
    assert bob.post("/users/alice/follow").json() == {"follow_status": "requested"}
    assert len(alice.get("/follow-requests").json()) == 1


def test_cannot_follow_yourself(client: TestClient) -> None:
    response = client.post("/users/reader/follow")
    assert response.status_code == 400
    assert response.json() == {"detail": "You can't follow yourself"}


def test_unfollow_and_cancel_request(make_client: MakeClient) -> None:
    alice, bob = make_client("alice"), make_client("bob")
    bob.post("/users/alice/follow")
    assert bob.delete("/users/alice/follow").status_code == 204  # cancel the request
    assert alice.get("/follow-requests").json() == []

    make_public(alice)
    bob.post("/users/alice/follow")
    assert bob.delete("/users/alice/follow").status_code == 204  # unfollow
    assert alice.get("/users/alice").json()["follower_count"] == 0
    assert bob.delete("/users/alice/follow").status_code == 204  # nothing left: still fine


def test_removing_a_follower_revokes_access(make_client: MakeClient) -> None:
    alice, bob = make_client("alice"), make_client("bob")
    alice.post("/books", json=BOOK)
    bob.post("/users/alice/follow")
    alice.post("/follow-requests/bob/accept")
    assert bob.get("/users/alice/books").status_code == 200

    assert alice.delete("/users/me/followers/bob").status_code == 204
    assert bob.get("/users/alice/books").status_code == 403
    assert bob.get("/users/alice").json()["follow_status"] == "none"


def test_going_private_keeps_existing_followers(make_client: MakeClient) -> None:
    alice, bob, carol = make_client("alice"), make_client("bob"), make_client("carol")
    make_public(alice)
    alice.post("/books", json=BOOK)
    bob.post("/users/alice/follow")
    alice.patch("/users/me", json={"is_public": False})

    assert bob.get("/users/alice/books").status_code == 200  # still a follower
    assert carol.get("/users/alice/books").status_code == 403  # strangers are locked out


def test_going_public_accepts_pending_requests(make_client: MakeClient) -> None:
    alice, bob, carol = make_client("alice"), make_client("bob"), make_client("carol")
    bob.post("/users/alice/follow")
    carol.post("/users/alice/follow")
    assert len(alice.get("/follow-requests").json()) == 2

    make_public(alice)
    assert alice.get("/follow-requests").json() == []
    assert alice.get("/users/alice").json()["follower_count"] == 2
    assert bob.get("/users/alice").json()["follow_status"] == "following"


def test_follow_requests_only_show_your_own(make_client: MakeClient) -> None:
    alice, bob, carol = make_client("alice"), make_client("bob"), make_client("carol")
    bob.post("/users/alice/follow")
    assert carol.get("/follow-requests").json() == []
    assert carol.post("/follow-requests/bob/accept").status_code == 404
    assert len(alice.get("/follow-requests").json()) == 1
