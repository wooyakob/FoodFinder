import os
import uuid
from datetime import datetime
from couchbase.cluster import Cluster
from couchbase.options import ClusterOptions
from couchbase.auth import PasswordAuthenticator
from couchbase.exceptions import CouchbaseException, DocumentNotFoundException
from dotenv import load_dotenv


class BookingManager:
    def __init__(self):
        load_dotenv()
        pa = PasswordAuthenticator(os.getenv("CB_USERNAME"), os.getenv("CB_PASSWORD"))
        self.cluster = Cluster(os.getenv("CB_HOSTNAME"), ClusterOptions(pa))
        self.bucket = self.cluster.bucket("restaurants")
        self.scope = self.bucket.scope("california")
        self._collection = None
        self._fallback: dict[str, dict] = {}
        self._use_couchbase = self._ensure_collection()

    def _ensure_collection(self) -> bool:
        try:
            from couchbase.management.collections import CollectionSpec
            cm = self.bucket.collections()
            try:
                cm.create_collection(CollectionSpec("bookings", scope_name="california"))
                print("[BookingManager] Created 'bookings' collection")
            except CouchbaseException as e:
                msg = str(e).lower()
                if "already exists" in msg or "409" in msg or "exists" in msg:
                    print("[BookingManager] 'bookings' collection already exists")
                else:
                    print(f"[BookingManager] Could not create collection: {e}")
                    return False
            self._collection = self.scope.collection("bookings")
            return True
        except Exception as e:
            print(f"[BookingManager] Falling back to in-memory store: {e}")
            return False

    # ------------------------------------------------------------------ #
    # Write                                                                #
    # ------------------------------------------------------------------ #

    def create_booking(self, restaurant_name: str, restaurant_url: str, date: str,
                       time: str, party_size: int, name: str, email: str, phone: str) -> dict:
        booking_id = str(uuid.uuid4())
        booking = {
            "type": "booking",
            "id": booking_id,
            "restaurant_name": restaurant_name,
            "restaurant_url": restaurant_url,
            "date": date,
            "time": time,
            "party_size": party_size,
            "name": name,
            "email": email,
            "phone": phone,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "status": "confirmed",
        }

        if self._use_couchbase and self._collection is not None:
            try:
                self._collection.upsert(f"booking::{booking_id}", booking)
                self._append_to_email_index(email, booking_id)
                return booking
            except CouchbaseException as e:
                print(f"[BookingManager] Couchbase write error, using fallback: {e}")

        self._fallback[booking_id] = booking
        email_idx = self._fallback.setdefault(f"__idx__{email}", {"ids": []})
        email_idx["ids"].append(booking_id)
        return booking

    def _append_to_email_index(self, email: str, booking_id: str) -> None:
        idx_key = f"bookings::email::{email}"
        try:
            result = self._collection.get(idx_key)
            idx = result.content_as[dict]
            idx["booking_ids"].append(booking_id)
            self._collection.upsert(idx_key, idx)
        except DocumentNotFoundException:
            self._collection.upsert(idx_key, {
                "type": "booking_index",
                "email": email,
                "booking_ids": [booking_id],
            })

    # ------------------------------------------------------------------ #
    # Read                                                                 #
    # ------------------------------------------------------------------ #

    def get_bookings_by_email(self, email: str) -> list[dict]:
        if self._use_couchbase and self._collection is not None:
            try:
                idx_key = f"bookings::email::{email}"
                idx = self._collection.get(idx_key).content_as[dict]
                bookings = []
                for bid in idx.get("booking_ids", []):
                    try:
                        doc = self._collection.get(f"booking::{bid}").content_as[dict]
                        bookings.append(doc)
                    except DocumentNotFoundException:
                        pass
                return sorted(bookings, key=lambda b: b.get("created_at", ""), reverse=True)
            except DocumentNotFoundException:
                return []
            except CouchbaseException as e:
                print(f"[BookingManager] Couchbase read error: {e}")

        idx = self._fallback.get(f"__idx__{email}", {})
        bookings = [self._fallback[bid] for bid in idx.get("ids", []) if bid in self._fallback]
        return sorted(bookings, key=lambda b: b.get("created_at", ""), reverse=True)

    # ------------------------------------------------------------------ #
    # Cancel                                                               #
    # ------------------------------------------------------------------ #

    def cancel_booking(self, booking_id: str, email: str) -> tuple[bool, str | dict]:
        if self._use_couchbase and self._collection is not None:
            try:
                key = f"booking::{booking_id}"
                doc = self._collection.get(key).content_as[dict]
                if doc.get("email") != email:
                    return False, "Unauthorized"
                doc["status"] = "cancelled"
                self._collection.upsert(key, doc)
                return True, doc
            except DocumentNotFoundException:
                return False, "Booking not found"
            except CouchbaseException as e:
                return False, str(e)

        booking = self._fallback.get(booking_id)
        if not booking:
            return False, "Booking not found"
        if booking.get("email") != email:
            return False, "Unauthorized"
        booking["status"] = "cancelled"
        return True, booking
