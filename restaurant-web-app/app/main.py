from flask import Flask, render_template, request, jsonify
from couchbase.cluster import Cluster
from couchbase.options import ClusterOptions
from couchbase.auth import PasswordAuthenticator
import os

from app.vector_search import RestaurantSearch
from app.booking_manager import BookingManager

app = Flask(__name__)

pa = PasswordAuthenticator(os.getenv("CB_USERNAME"), os.getenv("CB_PASSWORD"))
cluster = Cluster(os.getenv("CB_HOSTNAME"), ClusterOptions(pa))

search_client = RestaurantSearch()
booking_manager = BookingManager()


# ------------------------------------------------------------------ #
# Search                                                               #
# ------------------------------------------------------------------ #

@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        question = request.form.get("query")
        rows = search_client.search_restaurants(question)
        return jsonify({"results": rows})
    return render_template("index.html")


@app.route("/api/restaurant_count", methods=["GET"])
def restaurant_count():
    query = """
      SELECT COUNT(*) AS total_restaurants
      FROM `restaurants`.`california`.`vector` AS v
      WHERE
          v.name IS NOT NULL AND
          v.content IS NOT NULL AND
          v.price IS NOT NULL AND
          v.url IS NOT NULL AND
          v.geo IS NOT NULL AND
          v.phone IS NOT NULL;
    """
    result = cluster.query(query)
    count_row = list(result.rows())[0]
    return jsonify(count=count_row["total_restaurants"])


# ------------------------------------------------------------------ #
# Bookings                                                             #
# ------------------------------------------------------------------ #

@app.route("/api/bookings", methods=["POST"])
def create_booking():
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"error": "Request body must be valid JSON"}), 400
    required = ["restaurant_name", "date", "time", "party_size", "name", "email"]
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    try:
        party_size = int(data["party_size"])
        if party_size < 1 or party_size > 20:
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({"error": "party_size must be between 1 and 20"}), 400

    booking = booking_manager.create_booking(
        restaurant_name=data["restaurant_name"],
        restaurant_url=data.get("restaurant_url", ""),
        date=data["date"],
        time=data["time"],
        party_size=party_size,
        name=data["name"],
        email=data["email"],
        phone=data.get("phone", ""),
    )
    return jsonify({"booking": booking}), 201


@app.route("/api/bookings", methods=["GET"])
def list_bookings():
    email = request.args.get("email", "").strip()
    if not email:
        return jsonify({"error": "email query parameter is required"}), 400
    bookings = booking_manager.get_bookings_by_email(email)
    return jsonify({"bookings": bookings})


@app.route("/api/bookings/<booking_id>", methods=["DELETE"])
def cancel_booking(booking_id):
    data = request.get_json(force=True)
    email = (data or {}).get("email", "").strip()
    if not email:
        return jsonify({"error": "email is required"}), 400
    ok, result = booking_manager.cancel_booking(booking_id, email)
    if not ok:
        status = 403 if result == "Unauthorized" else 404
        return jsonify({"error": result}), status
    return jsonify({"booking": result})


if __name__ == "__main__":
    app.run(debug=True)
