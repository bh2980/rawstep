"""Optional client-owned instruction extension for the v1 choice protocol."""
import hashlib
import json
import re


def client_prompt(req, state, choices):
    control = req.get("promptControl")
    if control is None:
        if "instructions" in req or "prompt" in req:
            raise ValueError("Client instructions require promptControl=client-v1")
        return None
    if control != "client-v1":
        raise ValueError("Unsupported prompt control protocol")
    instructions = req.get("instructions")
    prompt = req.get("prompt", {})
    if not isinstance(instructions, str) or not instructions.strip() or len(instructions.encode()) > 16384:
        raise ValueError("Invalid client instructions")
    if re.search(r"<(?:image|video):\d+>", instructions):
        raise ValueError("Media references are owned by the bridge")
    if not isinstance(prompt, dict) or any(not isinstance(prompt.get(k), str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", prompt[k]) for k in ("id", "version")):
        raise ValueError("Client prompt needs a safe id and version")
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[:len(choices)]
    options = "\n".join(f"{letter}. {choice['id']}: {choice['label']}" for letter, choice in zip(letters, choices))
    state = {**state, "purpose": req.get("purpose", "action")}
    text = ("<state>\n" + json.dumps(state, ensure_ascii=False, indent=2) + "\n</state>\n\n"
            "Instructions: " + instructions + "\n\nOptions:\n" + options +
            "\n\nAnswer with one declared option letter: " + ", ".join(letters) + ".")
    sha = hashlib.sha256(json.dumps({"instructions": instructions, "choices": [{"id": c["id"], "label": c["label"]} for c in choices]},
                                    separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    return text, {"id": prompt["id"], "version": prompt["version"], "sha256": sha}
