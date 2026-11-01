"""يولّد كلمة سرّ عشوائية **داخل** آلة النسخ ولا يطبعها أبداً.

يطبع فقط «مُحقِّق SCRAM» (تجزئة لا تكشف كلمة السرّ) ليُنشأ به دور القراءة
المؤقّت في الإنتاج. كلمة السرّ نفسها لا تغادر هذه الآلة، ولا تمرّ بالمحادثة.
"""
import base64, hashlib, hmac, os, secrets, string

PW_FILE = "/root/.tf/pw"
os.makedirs(os.path.dirname(PW_FILE), mode=0o700, exist_ok=True)
pw = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(40))
fd = os.open(PW_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.write(fd, pw.encode()); os.close(fd)

salt, iters = secrets.token_bytes(16), 4096
salted = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, iters)
client_key = hmac.new(salted, b"Client Key", "sha256").digest()
stored_key = hashlib.sha256(client_key).digest()
server_key = hmac.new(salted, b"Server Key", "sha256").digest()
b64 = lambda b: base64.b64encode(b).decode()
print(f"SCRAM-SHA-256${iters}:{b64(salt)}${b64(stored_key)}:{b64(server_key)}")
