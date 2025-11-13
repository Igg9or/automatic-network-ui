#!/usr/bin/env python3
import json
import os
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, render_template, redirect, url_for, session, send_from_directory, abort

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret")

DATA_FILE = os.environ.get("DATA_FILE", os.path.join(os.path.dirname(__file__), "devices.txt"))

# ---------- Utilities ----------
def load_data():
    if not os.path.exists(DATA_FILE):
        return {"devices": [], "links": []}
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        raw = f.read().strip()
        if not raw:
            return {"devices": [], "links": []}
        # Support either JSON (single object) or JSON Lines with keys
        try:
            data = json.loads(raw)
            return data
        except json.JSONDecodeError:
            # JSON Lines fallback
            devices = []
            links = []
            for line in raw.splitlines():
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                if obj.get("_type") == "device":
                    devices.append(obj)
                elif obj.get("_type") == "link":
                    links.append(obj)
            return {"devices": devices, "links": links}

def save_data(data):
    # Save as a single JSON object for simplicity
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def require_auth():
    if "user" not in session:
        abort(401)

def find_device(devices, device_id):
    for d in devices:
        if str(d.get("id")) == str(device_id):
            return d
    return None

# ---------- Pages ----------
@app.route("/")
def index():
    if "user" not in session:
        return redirect(url_for("login_page"))
    return render_template("dashboard.html")

@app.route("/login", methods=["GET"])
def login_page():
    return render_template("login.html")

@app.route("/device/<device_id>")
def device_page(device_id):
    if "user" not in session:
        return redirect(url_for("login_page"))
    data = load_data()
    device = find_device(data["devices"], device_id)
    if not device:
        abort(404)
    return render_template("device.html", device_id=device_id)

# ---------- Auth (mock) ----------
@app.route("/api/login", methods=["POST"])
def api_login():
    content = request.json or request.form
    ip = content.get("ip", "").strip()
    username = content.get("username", "").strip()
    password = content.get("password", "").strip()
    enable = content.get("enable", "").strip()

    # Mock auth: accept anything non-empty
    if not (ip and username and password):
        return jsonify({"ok": False, "error": "IP, username and password are required"}), 400

    session["user"] = {
        "ip": ip, "username": username, "enable": enable, "at": datetime.utcnow().isoformat()
    }
    return jsonify({"ok": True})

@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.pop("user", None)
    return jsonify({"ok": True})

# ---------- API: Topology & Devices ----------
@app.route("/api/topology", methods=["GET"])
def api_topology():
    require_auth()
    data = load_data()
    return jsonify({"ok": True, "devices": data["devices"], "links": data["links"]})

@app.route("/api/devices", methods=["GET"])
def api_devices():
    require_auth()
    data = load_data()
    return jsonify({"ok": True, "devices": data["devices"]})

@app.route("/api/device/<device_id>", methods=["GET"])
def api_device(device_id):
    require_auth()
    data = load_data()
    d = find_device(data["devices"], device_id)
    if not d:
        return jsonify({"ok": False, "error": "Device not found"}), 404
    return jsonify({"ok": True, "device": d})

# ---------- Editable resources ----------
@app.route("/api/device/<device_id>/interfaces", methods=["PUT"])
def api_update_interfaces(device_id):
    require_auth()
    payload = request.json or {}
    new_ifaces = payload.get("interfaces", [])
    data = load_data()
    d = find_device(data["devices"], device_id)
    if not d:
        return jsonify({"ok": False, "error": "Device not found"}), 404

    # Basic validation
    if not isinstance(new_ifaces, list):
        return jsonify({"ok": False, "error": "interfaces must be a list"}), 400

    d["interfaces"] = new_ifaces
    save_data(data)
    return jsonify({"ok": True, "device": d})

@app.route("/api/device/<device_id>/vlans", methods=["PUT"])
def api_update_vlans(device_id):
    require_auth()
    payload = request.json or {}
    vlans = payload.get("vlans", [])
    data = load_data()
    d = find_device(data["devices"], device_id)
    if not d:
        return jsonify({"ok": False, "error": "Device not found"}), 404
    if not isinstance(vlans, list):
        return jsonify({"ok": False, "error": "vlans must be a list"}), 400
    d["vlans"] = vlans
    save_data(data)
    return jsonify({"ok": True, "device": d})

@app.route("/api/device/<device_id>/meta", methods=["PUT"])
def api_update_meta(device_id):
    require_auth()
    payload = request.json or {}
    data = load_data()
    d = find_device(data["devices"], device_id)
    if not d:
        return jsonify({"ok": False, "error": "Device not found"}), 404
    # Allow updating general editable fields
    editable = ["hostname", "management_ip", "location", "notes"]
    for k in editable:
        if k in payload:
            d[k] = payload[k]
    save_data(data)
    return jsonify({"ok": True, "device": d})

# ---------- Logs filtering (mock) ----------
@app.route("/api/device/<device_id>/logs", methods=["GET"])
def api_logs(device_id):
    require_auth()
    level = request.args.get("level")
    since = request.args.get("since")
    until = request.args.get("until")
    data = load_data()
    d = find_device(data["devices"], device_id)
    if not d:
        return jsonify({"ok": False, "error": "Device not found"}), 404

    logs = d.get("logs", [])
    def parse_time(ts):
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:
            return None

    if level:
        logs = [l for l in logs if l.get("level") == level]
    if since:
        t0 = parse_time(since)
        if t0:
            logs = [l for l in logs if parse_time(l.get("time")) and parse_time(l.get("time")) >= t0]
    if until:
        t1 = parse_time(until)
        if t1:
            logs = [l for l in logs if parse_time(l.get("time")) and parse_time(l.get("time")) <= t1]

    return jsonify({"ok": True, "logs": logs})

# ---------- Serve static TXT for transparency ----------
@app.route("/data/devices.txt")
def serve_devices_txt():
    return send_from_directory(os.path.dirname(DATA_FILE), os.path.basename(DATA_FILE))

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
