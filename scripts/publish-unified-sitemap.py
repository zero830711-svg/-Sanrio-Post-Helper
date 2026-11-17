"""Build the public sitemap from WordPress's current sitemap inventory."""
from concurrent.futures import ThreadPoolExecutor
import ftplib
import io
import os
import ssl
import uuid
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

BASE = "https://sanrio-fan.site/"
NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
TAG = "{" + NS + "}"
ET.register_namespace("", NS)
ET.register_namespace("image", "http://www.google.com/schemas/sitemap-image/1.1")


def fetch(url):
    if urlsplit(url).netloc != "sanrio-fan.site" or not url.startswith(BASE):
        raise ValueError("Unexpected sitemap host")
    with urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=45) as response:
        if response.url != url:
            raise ValueError(f"Unexpected redirect from {url}")
        return response.read()


def build():
    index = ET.fromstring(fetch(BASE + "sitemaps.xml"))
    if index.tag != TAG + "sitemapindex":
        raise ValueError("Expected the SEOPress sitemap index")
    sources = [item.findtext(TAG + "loc") for item in index.findall(TAG + "sitemap")]
    required = ("post-sitemap", "page-sitemap")
    if not all(any(url.startswith(BASE + prefix) for url in sources) for prefix in required):
        raise ValueError("Missing post or page sitemap")
    root = ET.Element(TAG + "urlset")
    entries = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for url, data in zip(sources, pool.map(fetch, sources)):
            child = ET.fromstring(data)
            if child.tag != TAG + "urlset":
                raise ValueError(f"Expected URL list at {url}")
            items = child.findall(TAG + "url")
            if not items and not url.startswith(BASE + "post_format-sitemap"):
                raise ValueError(f"Unexpected empty sitemap at {url}")
            for item in items:
                location = item.findtext(TAG + "loc")
                if not location or not location.startswith(BASE):
                    raise ValueError(f"Invalid page URL in {url}")
                if location in entries:
                    existing = entries[location]
                    known = {ET.tostring(node) for node in existing}
                    for node in item:
                        if node.tag not in {TAG + "loc", TAG + "lastmod"} and ET.tostring(node) not in known:
                            existing.append(node)
                else:
                    entries[location] = item
                    root.append(item)
    data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    if not 0 < len(entries) <= 50000 or len(data) > 52428800:
        raise ValueError("Sitemap is outside protocol limits")
    print(f"Built {len(entries)} unique URLs from {len(sources)} files. Bytes: {len(data)}")
    return data


def read(ftp, name):
    buffer = io.BytesIO()
    ftp.retrbinary("RETR " + name, buffer.write)
    return buffer.getvalue()


def write(ftp, name, data):
    temp = f"{name}.{uuid.uuid4().hex}.tmp"
    ftp.storbinary("STOR " + temp, io.BytesIO(data))
    if read(ftp, temp) != data:
        raise ValueError(f"Upload verification failed for {name}")
    ftp.rename(temp, name)


def publish(data):
    host = os.environ["LOLIPOP_FTP_HOST"]
    endpoint = urlsplit(host if "://" in host else "ftp://" + host)
    with ftplib.FTP_TLS(timeout=45, context=ssl.create_default_context()) as ftp:
        ftp.connect(endpoint.hostname, endpoint.port or 21)
        ftp.login(os.environ["LOLIPOP_FTP_USER"], os.environ["LOLIPOP_FTP_PASSWORD"])
        ftp.prot_p()
        ftp.cwd("sanrio-fan")
        if "wp-config.php" not in ftp.nlst() or read(ftp, "ads.txt") != fetch(BASE + "ads.txt"):
            raise ValueError("Unable to verify the WordPress document root")
        robots = read(ftp, "robots.txt")
        if robots != fetch(BASE + "robots.txt"):
            raise ValueError("Public robots.txt differs from the copy on the server")
        rules = [line for line in robots.splitlines(keepends=True)
                 if not line.lstrip().lower().startswith(b"sitemap:")]
        new_robots = b"".join(rules).rstrip() + b"\n\nSitemap: " + (BASE + "sitemap.xml").encode() + b"\n"

        files = set(ftp.nlst())
        old = read(ftp, "sitemap.xml") if "sitemap.xml" in files else None
        changed = old != data
        robots_changed = robots != new_robots
        try:
            if changed:
                write(ftp, "sitemap.xml", data)
            if fetch(BASE + "sitemap.xml") != data:
                raise ValueError("Public /sitemap.xml differs from the built XML")
            if robots_changed:
                write(ftp, "robots.txt", new_robots)
                if fetch(BASE + "robots.txt") != new_robots:
                    raise ValueError("Public robots.txt differs from the uploaded file")
        except Exception:
            if robots_changed and read(ftp, "robots.txt") == new_robots:
                write(ftp, "robots.txt", robots)
            if changed and "sitemap.xml" in ftp.nlst() and read(ftp, "sitemap.xml") == data:
                if old is None:
                    ftp.delete("sitemap.xml")
                else:
                    write(ftp, "sitemap.xml", old)
            raise
    print("Verified direct /sitemap.xml response and robots.txt")


if __name__ == "__main__":
    import sys
    sitemap = build()
    if sys.argv[1:] == ["--publish"]:
        publish(sitemap)
