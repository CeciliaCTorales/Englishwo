import csv
import io
import json as json_lib
import random
import re
import shutil
import ssl
import string
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request, Response
from jinja2 import ChoiceLoader, FileSystemLoader

_ROOT = Path(__file__).resolve().parent

app = Flask(__name__)
app.jinja_loader = ChoiceLoader(
    [
        FileSystemLoader(str(_ROOT)),
        FileSystemLoader(str(_ROOT / "templates")),
    ]
)


def _https_ssl_context():
    """CA bundle para HTTPS. `certifi` evita fallos típicos de Python en macOS."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def _is_ssl_verify_error(exc):
    r = getattr(exc, "reason", exc)
    if isinstance(r, ssl.SSLError):
        return True
    return "CERTIFICATE_VERIFY_FAILED" in str(r) or "certificate verify failed" in str(r).lower()


def _https_get(url, user_agent="Mozilla/5.0 (compatible; Palabras/1.0)"):
    """
    GET HTTPS. Si Python no valida certificados (muy habitual en macOS + Python.org),
    reintenta con curl, que usa el almacén del sistema.
    """
    req = urllib.request.Request(url, headers={"User-Agent": user_agent})
    ctx = _https_ssl_context()
    try:
        with urllib.request.urlopen(req, timeout=14, context=ctx) as resp:
            return resp.read().decode()
    except urllib.error.URLError as e:
        if _is_ssl_verify_error(e):
            return _https_get_curl(url, user_agent)
        print("Traducción (red):", getattr(e, "reason", e))
        return None
    except TimeoutError:
        return None


def _https_get_curl(url, user_agent):
    try:
        proc = subprocess.run(
            [
                "curl",
                "-sS",
                "-L",
                "--max-time",
                "15",
                "-A",
                user_agent,
                url,
            ],
            capture_output=True,
            text=True,
            timeout=18,
        )
        if proc.returncode != 0:
            print("Traducción (curl):", (proc.stderr or "").strip() or proc.returncode)
            return None
        return proc.stdout
    except FileNotFoundError:
        print("Traducción: curl no encontrado; instala certifi: pip install certifi")
        return None
    except (subprocess.TimeoutExpired, OSError) as e:
        print("Traducción (curl):", e)
        return None

DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_FILE = DATA_DIR / "palabras.csv"
BACKUP_DIR = DATA_DIR / "backups"
LEGACY_JSON = DATA_DIR / "palabras.json"

CSV_FIELDS = ["id", "palabra", "ejemplo", "dicho", "fecha", "tema", "etiquetas", "aprendido"]
BACKUP_KEEP = 10
IMPORT_MAX_BYTES = 2 * 1024 * 1024

palabras = []


def _next_id():
    if not palabras:
        return 1
    return max(int(p.get("id", 0)) for p in palabras) + 1


def _strip_edge_punct(s):
    s = (s or "").strip()
    punct = string.punctuation + "¿¡"
    while s and s[0] in punct:
        s = s[1:].lstrip()
    while s and s[-1] in punct:
        s = s[:-1].rstrip()
    return s


def _capitalize_first_letter(s):
    """Primera letra en mayúscula; el resto igual (p. ej. hello → Hello, iPhone → IPhone)."""
    s = (s or "").strip()
    if not s:
        return s
    return s[0].upper() + s[1:]


def _palabra_key(s):
    return _strip_edge_punct(s).lower()


def _split_texto(raw):
    raw = (raw or "").strip()
    partes = raw.split()
    if not partes:
        return "", "", raw
    palabra = _capitalize_first_letter(_strip_edge_punct(partes[0]))
    ejemplo = " ".join(partes[1:]).strip() if len(partes) > 1 else ""
    return palabra, ejemplo, raw


def _normalize_meta_tema(s):
    return re.sub(r"\s+", " ", (s or "").strip())[:200]


def _normalize_meta_etiquetas(s):
    s = (s or "").strip()
    if not s:
        return ""
    parts = [re.sub(r"\s+", " ", p.strip().lstrip("#")) for p in s.split(",")]
    parts = [p for p in parts if p]
    return ", ".join(parts)[:500]


def _row_from_dict(p):
    return {
        "id": str(int(p.get("id", 0))),
        "palabra": p.get("palabra", "") or "",
        "ejemplo": p.get("ejemplo", "") or "",
        "dicho": p.get("dicho", "") or "",
        "fecha": p.get("fecha", "") or "",
        "tema": p.get("tema", "") or "",
        "etiquetas": p.get("etiquetas", "") or "",
        "aprendido": "1" if bool(p.get("aprendido")) else "0",
    }


def _entry_from_row(row, rid):
    aprendido_raw = (row.get("aprendido") or "").strip().lower()
    return {
        "id": rid,
        "palabra": _capitalize_first_letter((row.get("palabra") or "").strip()),
        "ejemplo": (row.get("ejemplo") or "").strip(),
        "dicho": (row.get("dicho") or "").strip(),
        "fecha": (row.get("fecha") or "").strip(),
        "tema": (row.get("tema") or "").strip(),
        "etiquetas": (row.get("etiquetas") or "").strip(),
        "aprendido": aprendido_raw in ("1", "true", "si", "sí", "yes"),
    }


def _rotate_backup():
    try:
        if not DATA_FILE.is_file():
            return
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest = BACKUP_DIR / f"palabras_{ts}.csv"
        shutil.copy2(DATA_FILE, dest)
        files = sorted(BACKUP_DIR.glob("palabras_*.csv"), reverse=True)
        for old in files[BACKUP_KEEP:]:
            try:
                old.unlink()
            except OSError:
                pass
    except OSError as e:
        print("Backup CSV:", e)


def load_palabras():
    global palabras
    palabras = []

    if DATA_FILE.is_file():
        try:
            with open(DATA_FILE, "r", encoding="utf-8", newline="") as f:
                reader = csv.DictReader(f)
                if reader.fieldnames is None:
                    return
                for row in reader:
                    try:
                        rid = int((row.get("id") or "0").strip())
                    except ValueError:
                        continue
                    palabras.append({
                        "id": rid,
                        "palabra": (row.get("palabra") or "").strip(),
                        "ejemplo": (row.get("ejemplo") or "").strip(),
                        "dicho": (row.get("dicho") or "").strip(),
                        "fecha": (row.get("fecha") or "").strip(),
                        "tema": (row.get("tema") or "").strip(),
                        "etiquetas": (row.get("etiquetas") or "").strip(),
                        "aprendido": (row.get("aprendido") or "").strip().lower() in ("1", "true", "si", "sí", "yes"),
                    })
        except (OSError, ValueError) as e:
            print("Carga CSV:", e)
            palabras = []
        return

    if LEGACY_JSON.is_file():
        try:
            with open(LEGACY_JSON, "r", encoding="utf-8") as f:
                data = json_lib.load(f)
            raw = data.get("palabras", [])
            if isinstance(raw, list):
                palabras = [
                    {
                        "id": int(p.get("id", 0)),
                        "palabra": p.get("palabra", "") or "",
                        "ejemplo": p.get("ejemplo", "") or "",
                        "dicho": p.get("dicho", "") or "",
                        "fecha": p.get("fecha", "") or "",
                        "tema": "",
                        "etiquetas": "",
                        "aprendido": False,
                    }
                    for p in raw
                    if isinstance(p, dict)
                ]
            save_palabras()
        except (OSError, ValueError, TypeError, json_lib.JSONDecodeError) as e:
            print("Migración JSON:", e)
            palabras = []


def save_palabras():
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp = DATA_FILE.with_suffix(".csv.tmp")
        with open(tmp, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(
                f,
                fieldnames=CSV_FIELDS,
                quoting=csv.QUOTE_MINIMAL,
                extrasaction="ignore",
            )
            w.writeheader()
            for p in sorted(palabras, key=lambda x: int(x.get("id", 0))):
                w.writerow(_row_from_dict(p))
        tmp.replace(DATA_FILE)
        _rotate_backup()
    except OSError as e:
        print("Guardar CSV:", e)


def _migrate_capitalize_palabras():
    """Al arrancar: primera letra en mayúscula en todas las entradas ya guardadas."""
    global palabras
    changed = False
    for p in palabras:
        w = (p.get("palabra") or "").strip()
        if not w:
            continue
        new_w = _capitalize_first_letter(w)
        if new_w != w:
            p["palabra"] = new_w
            changed = True
    if changed:
        save_palabras()


load_palabras()
_migrate_capitalize_palabras()


def _traducir_google(texto):
    q = urllib.parse.quote(texto)
    url = (
        "https://translate.googleapis.com/translate_a/single"
        f"?client=gtx&sl=en&tl=es&dt=t&q={q}"
    )
    raw = _https_get(url)
    if not raw:
        return None
    try:
        data = json_lib.loads(raw)
    except (ValueError, TypeError, json_lib.JSONDecodeError):
        return None
    if not isinstance(data, list) or not data or not data[0]:
        return None
    try:
        partes = []
        for seg in data[0]:
            if isinstance(seg, list) and len(seg) > 0 and seg[0]:
                partes.append(seg[0])
        out = "".join(partes).strip()
        return out or None
    except (TypeError, IndexError):
        return None


def _traducir_mymemory(texto):
    q = urllib.parse.quote(texto)
    url = f"https://api.mymemory.translated.net/get?q={q}&langpair=en|es"
    raw = _https_get(url, user_agent="Palabras/1.0")
    if not raw:
        return None
    try:
        payload = json_lib.loads(raw)
    except (ValueError, json_lib.JSONDecodeError):
        return None
    translated = (
        payload.get("responseData") or {}
    ).get("translatedText") or ""
    if not translated:
        return None
    if "MYMEMORY WARNING" in translated.upper():
        return None
    return translated.strip() or None


def _count_duplicates(key):
    if not key:
        return 0
    return sum(
        1 for p in palabras if _palabra_key(p.get("palabra", "")) == key
    )


def _practice_sentence_templates(token):
    w = token
    return [
        f"I want to remember the English word «{w}».",
        f"Can you use «{w}» in a simple sentence?",
        f"She practiced pronouncing «{w}» several times.",
        f"«{w}» is a useful word to know in English.",
    ]


def _truncate_sentence(s, max_len=340):
    s = (s or "").strip()
    if len(s) <= max_len:
        return s
    cut = s[: max_len - 1]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut + "…"


def _dictionary_random_sentence(headword):
    """
    Oración para repaso: prioriza `example` del diccionario; si no hay (muy frecuente),
    usa el texto de `definition`; si falla la red, plantillas cortas en inglés.
    Devuelve (texto, error) — error solo si no hay nada útil y hay que avisar al usuario.
    """
    parts = (headword or "").strip().split()
    if not parts:
        return None, "Falta la palabra."
    token = _strip_edge_punct(parts[0])
    token = re.sub(r"[^a-zA-Z0-9'-]", "", token)
    if not token or len(token) > 48:
        return None, "Palabra no válida para buscar en el diccionario."

    q = urllib.parse.quote(token.lower(), safe="")
    url = f"https://api.dictionaryapi.dev/api/v2/entries/en/{q}"
    raw = _https_get(url)

    if not raw:
        return random.choice(_practice_sentence_templates(token)), None

    try:
        data = json_lib.loads(raw)
    except (ValueError, TypeError, json_lib.JSONDecodeError):
        return random.choice(_practice_sentence_templates(token)), None

    if not isinstance(data, list) or len(data) == 0:
        return None, (
            "No encontré esa palabra en el diccionario en inglés. "
            "Revisá la ortografía o probá la forma base (sin plurales raros)."
        )

    examples = []
    definitions = []
    for entry in data:
        for m in entry.get("meanings") or []:
            for d in m.get("definitions") or []:
                ex = d.get("example")
                if isinstance(ex, str) and ex.strip():
                    examples.append(ex.strip())
                df = d.get("definition")
                if isinstance(df, str) and df.strip():
                    definitions.append(df.strip())

    if examples:
        return _truncate_sentence(random.choice(examples)), None

    defs_ok = [d for d in definitions if 8 <= len(d) <= 600]
    if defs_ok:
        return _truncate_sentence(random.choice(defs_ok)), None

    if definitions:
        return _truncate_sentence(random.choice(definitions)), None

    return random.choice(_practice_sentence_templates(token)), None


@app.route("/api/ejemplo-aleatorio")
def api_ejemplo_aleatorio():
    word = (request.args.get("w") or "").strip()
    texto, err = _dictionary_random_sentence(word)
    if texto:
        return jsonify({"ok": True, "ejemplo": texto})
    return jsonify({"ok": False, "error": err or "No se pudo generar una oración."})


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/index.html")
def home_html():
    return render_template("index.html")


@app.route("/repaso")
def repaso():
    return render_template("repaso.html")


@app.route("/repaso.html")
def repaso_html():
    return render_template("repaso.html")


@app.route("/api/palabras")
def api_palabras():
    return jsonify({"ok": True, "data": palabras})


@app.route("/api/export.csv")
def api_export_csv():
    buf = io.StringIO()
    w = csv.DictWriter(
        buf,
        fieldnames=CSV_FIELDS,
        quoting=csv.QUOTE_MINIMAL,
        extrasaction="ignore",
    )
    w.writeheader()
    for p in sorted(palabras, key=lambda x: int(x.get("id", 0))):
        w.writerow(_row_from_dict(p))
    name = f"palabras_export_{datetime.now().strftime('%Y%m%d')}.csv"
    return Response(
        buf.getvalue().encode("utf-8"),
        mimetype="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{name}"',
        },
    )


@app.route("/api/import", methods=["POST"])
def api_import():
    mode = (request.form.get("mode") or "merge").strip().lower()
    if mode not in ("merge", "replace"):
        return jsonify({"ok": False, "error": "mode inválido"}), 400
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "Falta archivo"}), 400
    raw = f.read()
    if len(raw) > IMPORT_MAX_BYTES:
        return jsonify({"ok": False, "error": "Archivo demasiado grande"}), 400
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return jsonify({"ok": False, "error": "UTF-8 requerido"}), 400

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "palabra" not in reader.fieldnames:
        return jsonify({"ok": False, "error": "CSV sin columna palabra"}), 400

    rows = []
    for row in reader:
        if not isinstance(row, dict):
            continue
        pal = (row.get("palabra") or "").strip()
        if not pal:
            continue
        rows.append(row)

    global palabras
    if mode == "replace":
        palabras = []
        nid = 1
        for row in rows:
            palabras.append(_entry_from_row(row, nid))
            nid += 1
    else:
        for row in rows:
            palabras.append(_entry_from_row(row, _next_id()))

    save_palabras()
    return jsonify({"ok": True, "data": palabras, "imported": len(rows)})


@app.route("/procesar", methods=["POST"])
def procesar():
    data = request.get_json() or {}
    raw = (data.get("texto") or "").strip()
    force = bool(data.get("force"))
    tema = _normalize_meta_tema(data.get("tema"))
    etiquetas = _normalize_meta_etiquetas(data.get("etiquetas"))

    palabra, ejemplo, dicho = _split_texto(raw)
    if not palabra:
        return jsonify({
            "ok": False,
            "error": "vacío",
            "message": "No se detectó una palabra principal. Di o escribe al menos una palabra en inglés.",
        }), 400

    key = _palabra_key(palabra)
    dup = _count_duplicates(key)
    if dup > 0 and not force:
        return jsonify({
            "ok": False,
            "duplicate": True,
            "count": dup,
            "palabra": palabra,
        }), 409

    fecha = datetime.now().strftime("%d/%m/%Y")
    palabras.append({
        "id": _next_id(),
        "palabra": palabra,
        "ejemplo": ejemplo,
        "dicho": dicho or raw,
        "fecha": fecha,
        "tema": tema,
        "etiquetas": etiquetas,
        "aprendido": False,
    })
    save_palabras()
    return jsonify({"ok": True, "data": palabras})


@app.route("/borrar/<int:id>", methods=["DELETE"])
def borrar(id):
    global palabras
    palabras = [p for p in palabras if p["id"] != id]
    save_palabras()
    return jsonify({"ok": True, "data": palabras})


@app.route("/editar/<int:id>", methods=["PUT"])
def editar(id):
    data = request.get_json() or {}
    for p in palabras:
        if p["id"] == id:
            if "palabra" in data:
                np = _capitalize_first_letter(
                    _strip_edge_punct(str(data.get("palabra", "")))
                )
                if np:
                    p["palabra"] = np
            if "ejemplo" in data:
                p["ejemplo"] = (data.get("ejemplo") or "").strip()
            if "dicho" in data:
                p["dicho"] = (data.get("dicho") or "").strip()
            if "tema" in data:
                p["tema"] = _normalize_meta_tema(data.get("tema"))
            if "etiquetas" in data:
                p["etiquetas"] = _normalize_meta_etiquetas(data.get("etiquetas"))
            if "aprendido" in data:
                p["aprendido"] = bool(data.get("aprendido"))
    save_palabras()
    return jsonify({"ok": True, "data": palabras})


@app.route("/traducir", methods=["POST"])
def traducir():
    data = request.get_json() or {}
    texto = (data.get("texto") or "").strip()
    if not texto:
        return jsonify({"ok": False, "error": "Texto vacío"}), 400
    if len(texto) > 500:
        texto = texto[:500]

    salida = _traducir_google(texto)
    if not salida:
        salida = _traducir_mymemory(texto)

    if not salida:
        return jsonify({"ok": False, "error": "No se pudo traducir"}), 502

    return jsonify({"ok": True, "traduccion": salida})


if __name__ == "__main__":
    app.run(debug=True, use_reloader=False)
