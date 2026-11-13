from pathlib import Path
import json, fitz, zxingcpp
from PIL import Image
root=Path(__file__).resolve().parents[2]
out=root/"docs/user-manual"
content=json.loads((root/"docs/user-manual-src/content.json").read_text())
n=len(content["lessons"])+2
checks=[]
for language in ["EN","TH"]:
    p=fitz.open(out/f"TRIGO-User-Manual-{language}.pdf")
    assert len(p)==n, (language,len(p),n)
    assert all(len(page.get_text())>50 for page in p), "missing text"
    assert all(content["version"] in page.get_text() for page in p), "missing version label"
    assert len(p[1].get_links())==16, "contents links missing"
    access=p[2]
    assert any(link.get("uri","").startswith(content["url"]) for link in access.get_links()), "app link missing"
    pix=access.get_pixmap(matrix=fitz.Matrix(2,2))
    image=Image.frombytes("RGB",[pix.width,pix.height],pix.samples)
    codes=[r.text for r in zxingcpp.read_barcodes(image)]
    assert content["url"] in codes, "QR does not decode"
    if language=="TH":
        assert all(any("\u0e00"<=c<="\u0e7f" for c in page.get_text()) for page in p), "Thai missing"
    checks.append({"language":language,"slides":n,"contentsLinks":16,"qrDestination":content["url"],"version":content["version"],"sizeBytes":(out/f"TRIGO-User-Manual-{language}.pdf").stat().st_size})
layout=json.loads((out/"layout-validation.json").read_text())
assert all(not entry["layoutIssues"] for entry in layout), "layout issues"
(out/"pdf-validation.json").write_text(json.dumps({"files":checks,"layoutIssues":0,"captureSource":"Real current app, synthetic example data; mobile emulated"},indent=2))
print(json.dumps(checks))
