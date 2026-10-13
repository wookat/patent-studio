import json, re, urllib.request, concurrent.futures, time

UA = {"User-Agent": "Mozilla/5.0"}
links = json.load(open("/home/ubuntu/ps/survey/links.json"))
stats = json.load(open("/home/ubuntu/ps/survey/stats2.json"))
pids = [p for p in stats["rows"] if p.startswith("CN")]
todo = [p for p in pids if p not in links]
print("to resolve:", len(todo), "already:", len(links))

def resolve(pid):
    url = f"https://r.jina.ai/https://patents.google.com/patent/{pid}/zh"
    try:
        txt = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read().decode("utf-8", "ignore")
        m = re.search(r"https://patentimages\.storage\.googleapis\.com/[\w/]+/" + pid + r"\.pdf", txt)
        if m:
            return pid, m.group(0)
        m2 = re.search(r"https://patentimages\.storage\.googleapis\.com/[\w/]+\.pdf", txt)
        return pid, m2.group(0) if m2 else None
    except Exception as e:
        return pid, None

got = 0
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
    futs = {ex.submit(resolve, p): p for p in todo}
    for i, fut in enumerate(concurrent.futures.as_completed(futs)):
        pid, url = fut.result()
        if url:
            links[pid] = url
            got += 1
        if i % 10 == 0:
            print(i, "resolved", got)
            time.sleep(0.5)
json.dump(links, open("/home/ubuntu/ps/survey/links.json", "w"), ensure_ascii=False, indent=1)
print("total links:", len(links), "new:", got)
