// ------------------------------------------------------------------ //
// Utilities                                                            //
// ------------------------------------------------------------------ //

function openModal(id) {
    const el = document.getElementById(id);
    el.removeAttribute("hidden");
    el.querySelector(".modal-box").focus();
}

function closeModal(id) {
    document.getElementById(id).setAttribute("hidden", "");
}

function formatDate(iso) {
    const [y, m, d] = iso.split("-");
    return new Date(y, m - 1, d).toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
}

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ------------------------------------------------------------------ //
// Init                                                                 //
// ------------------------------------------------------------------ //

window.addEventListener("DOMContentLoaded", () => {
    populateTimePicker();
    setMinBookingDate();
    setupRestaurantCount();
    setupSearch();
    setupModalCloseHandlers();
    setupBookingForm();
    setupMyBookings();
});

// ------------------------------------------------------------------ //
// Restaurant count                                                     //
// ------------------------------------------------------------------ //

async function setupRestaurantCount() {
    const el = document.getElementById("restaurantCountDisplay");
    try {
        const res = await fetch("/api/restaurant_count");
        const data = await res.json();
        el.textContent = `${data.count} restaurants`;
    } catch {
        el.textContent = "";
    }
}

// ------------------------------------------------------------------ //
// Search                                                               //
// ------------------------------------------------------------------ //

function setupSearch() {
    const form = document.getElementById("searchForm");
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const query = document.getElementById("query").value.trim();
        if (!query) return;

        const resultsDiv = document.getElementById("results");
        resultsDiv.innerHTML = '<p class="loading">Searching…</p>';

        try {
            const res = await fetch("/", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ query }),
            });
            const data = await res.json();
            renderResults(data.results || []);
        } catch {
            resultsDiv.innerHTML = "<p>Search failed. Please try again.</p>";
        }
    });
}

function renderResults(results) {
    const resultsDiv = document.getElementById("results");
    resultsDiv.innerHTML = "";

    if (!results.length) {
        resultsDiv.innerHTML = "<p>No results found.</p>";
        return;
    }

    results.forEach((r) => {
        const card = document.createElement("div");
        card.className = "result-card";

        const address = r.location?.address ?? "N/A";
        const phone   = r.phone ?? "N/A";
        const price   = r.price ?? "N/A";
        const url     = r.url   ?? "#";

        card.innerHTML = `
            <div class="card-header">
                <h2>${escapeHtml(r.name)}</h2>
                <button class="btn-book" data-name="${escapeHtml(r.name)}" data-url="${escapeHtml(url)}">
                    Book a Table
                </button>
            </div>
            <p class="card-desc">${escapeHtml(r.content)}</p>
            <div class="card-meta">
                <span><strong>Address:</strong> ${escapeHtml(address)}</span>
                <span><strong>Phone:</strong> ${escapeHtml(phone)}</span>
                <span><strong>Price:</strong> ${escapeHtml(price)}</span>
                <span><strong>Website:</strong> <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></span>
            </div>
        `;

        if (r.location?.embedUrl) {
            const iframe = document.createElement("iframe");
            iframe.width = "100%";
            iframe.height = "200";
            iframe.style.border = "0";
            iframe.loading = "lazy";
            iframe.allowFullscreen = true;
            iframe.referrerPolicy = "no-referrer-when-downgrade";
            iframe.src = r.location.embedUrl;
            card.appendChild(iframe);
        }

        resultsDiv.appendChild(card);
    });

    // Wire up "Book a Table" buttons
    resultsDiv.querySelectorAll(".btn-book").forEach((btn) => {
        btn.addEventListener("click", () => openBookingModal(btn.dataset.name, btn.dataset.url));
    });
}

// ------------------------------------------------------------------ //
// Modal close handlers                                                 //
// ------------------------------------------------------------------ //

function setupModalCloseHandlers() {
    // Close buttons with data-close attribute
    document.addEventListener("click", (e) => {
        const target = e.target.closest("[data-close]");
        if (target) closeModal(target.dataset.close);
    });

    // Click outside modal box
    document.querySelectorAll(".modal-overlay").forEach((overlay) => {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closeModal(overlay.id);
        });
    });

    // Escape key
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            document.querySelectorAll(".modal-overlay:not([hidden])").forEach((m) => {
                closeModal(m.id);
            });
        }
    });
}

// ------------------------------------------------------------------ //
// Booking modal                                                        //
// ------------------------------------------------------------------ //

function populateTimePicker() {
    const select = document.getElementById("bTime");
    for (let h = 9; h <= 22; h++) {
        ["00", "30"].forEach((m) => {
            if (h === 22 && m === "30") return;
            const val = `${String(h).padStart(2, "0")}:${m}`;
            const label = formatTime(val);
            const opt = document.createElement("option");
            opt.value = val;
            opt.textContent = label;
            select.appendChild(opt);
        });
    }
    // Default to noon
    select.value = "12:00";
}

function setMinBookingDate() {
    const input = document.getElementById("bDate");
    input.min = new Date().toISOString().split("T")[0];
    input.value = input.min;
}

function formatTime(val) {
    const [h, m] = val.split(":").map(Number);
    const suffix = h < 12 ? "AM" : "PM";
    const display = h % 12 || 12;
    return `${display}:${String(m).padStart(2, "0")} ${suffix}`;
}

function openBookingModal(name, url) {
    document.getElementById("bRestaurantName").value = name;
    document.getElementById("bRestaurantUrl").value  = url;
    document.getElementById("bookingRestaurantName").textContent = name;
    document.getElementById("bookingError").setAttribute("hidden", "");
    document.getElementById("bookingForm").reset();
    // Re-apply date min after reset
    setMinBookingDate();
    // Re-apply time default after reset
    document.getElementById("bTime").value = "12:00";
    openModal("bookingModal");
}

function setupBookingForm() {
    document.getElementById("bookingForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const errEl = document.getElementById("bookingError");
        errEl.setAttribute("hidden", "");

        const payload = {
            restaurant_name: document.getElementById("bRestaurantName").value,
            restaurant_url:  document.getElementById("bRestaurantUrl").value,
            date:            document.getElementById("bDate").value,
            time:            document.getElementById("bTime").value,
            party_size:      parseInt(document.getElementById("bPartySize").value, 10),
            name:            document.getElementById("bName").value.trim(),
            email:           document.getElementById("bEmail").value.trim(),
            phone:           document.getElementById("bPhone").value.trim(),
        };

        try {
            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) {
                errEl.textContent = data.error ?? "Something went wrong.";
                errEl.removeAttribute("hidden");
                return;
            }
            closeModal("bookingModal");
            showConfirmation(data.booking);
        } catch {
            errEl.textContent = "Network error. Please try again.";
            errEl.removeAttribute("hidden");
        }
    });
}

function showConfirmation(booking) {
    document.getElementById("confirmDetails").innerHTML = `
        <p><strong>Restaurant:</strong> ${escapeHtml(booking.restaurant_name)}</p>
        <p><strong>Date:</strong> ${escapeHtml(formatDate(booking.date))}</p>
        <p><strong>Time:</strong> ${escapeHtml(formatTime(booking.time))}</p>
        <p><strong>Guests:</strong> ${escapeHtml(String(booking.party_size))}</p>
        <p><strong>Name:</strong> ${escapeHtml(booking.name)}</p>
        <p class="booking-id">Confirmation # <code>${escapeHtml(booking.id)}</code></p>
    `;
    openModal("confirmModal");
}

// ------------------------------------------------------------------ //
// My Bookings                                                          //
// ------------------------------------------------------------------ //

function setupMyBookings() {
    document.getElementById("myBookingsBtn").addEventListener("click", () => {
        document.getElementById("bookingsList").innerHTML = "";
        document.getElementById("lookupEmail").value = "";
        document.getElementById("lookupError").setAttribute("hidden", "");
        openModal("myBookingsModal");
    });

    document.getElementById("lookupBtn").addEventListener("click", lookupBookings);
    document.getElementById("lookupEmail").addEventListener("keydown", (e) => {
        if (e.key === "Enter") lookupBookings();
    });
}

async function lookupBookings() {
    const email = document.getElementById("lookupEmail").value.trim();
    const errEl  = document.getElementById("lookupError");
    const listEl = document.getElementById("bookingsList");

    errEl.setAttribute("hidden", "");
    listEl.innerHTML = "";

    if (!email) {
        errEl.textContent = "Please enter an email address.";
        errEl.removeAttribute("hidden");
        return;
    }

    listEl.innerHTML = '<p class="loading">Loading…</p>';

    try {
        const res  = await fetch(`/api/bookings?email=${encodeURIComponent(email)}`);
        const data = await res.json();
        if (!res.ok) {
            errEl.textContent = data.error ?? "Failed to load bookings.";
            errEl.removeAttribute("hidden");
            listEl.innerHTML = "";
            return;
        }
        renderBookingsList(data.bookings, email, listEl);
    } catch {
        errEl.textContent = "Network error.";
        errEl.removeAttribute("hidden");
        listEl.innerHTML = "";
    }
}

function renderBookingsList(bookings, email, container) {
    if (!bookings.length) {
        container.innerHTML = "<p>No bookings found for this email.</p>";
        return;
    }

    container.innerHTML = "";
    bookings.forEach((b) => {
        const row = document.createElement("div");
        row.className = `booking-row ${b.status === "cancelled" ? "booking-row--cancelled" : ""}`;
        row.innerHTML = `
            <div class="booking-row-info">
                <strong>${escapeHtml(b.restaurant_name)}</strong>
                <span>${escapeHtml(formatDate(b.date))} at ${escapeHtml(formatTime(b.time))}</span>
                <span>${escapeHtml(String(b.party_size))} guest${b.party_size !== 1 ? "s" : ""}</span>
                <span class="booking-status booking-status--${escapeHtml(b.status)}">${escapeHtml(b.status)}</span>
            </div>
            ${b.status === "confirmed"
                ? `<button class="btn-cancel" data-id="${escapeHtml(b.id)}" data-email="${escapeHtml(email)}">Cancel</button>`
                : ""}
        `;
        container.appendChild(row);
    });

    container.querySelectorAll(".btn-cancel").forEach((btn) => {
        btn.addEventListener("click", () => cancelBooking(btn.dataset.id, btn.dataset.email));
    });
}

async function cancelBooking(bookingId, email) {
    if (!confirm("Cancel this reservation?")) return;
    try {
        const res  = await fetch(`/api/bookings/${bookingId}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
        });
        if (res.ok) {
            lookupBookings();
        } else {
            const data = await res.json();
            alert(data.error ?? "Could not cancel booking.");
        }
    } catch {
        alert("Network error.");
    }
}
