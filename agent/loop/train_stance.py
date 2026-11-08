"""Phase 2 of the stance classifier: LoRA SFT of GLM 5.3 Flash on Fireworks Serverless Training, trained on the
frontier-model labels from loop/export-labels.ts. GLM 5.3 Flash is the one base whose LoRA serves serverlessly
(Specialized Model Inference), so classify_stance.ts can call the result through the OpenAI-compatible endpoint.

  node --disable-warning=ExperimentalWarning loop/export-labels.ts train.jsonl holdout.jsonl
  python3 -m venv .venv && .venv/bin/pip install "fireworks-ai[training]" transformers requests
  FIREWORKS_API_KEY=... .venv/bin/python loop/train_stance.py train.jsonl holdout.jsonl [--smoke] [--epochs 2]
      [--lr 1e-4] [--batch 8] [--rank 16] [--model-id groundswell-stance-v1] [--no-base-eval]

Per epoch: sampler checkpoint, holdout agreement with the frontier labels, promote to accounts/<acct>/models/<model-id>-epN
and load it on serverless. Put that id into config/models.json "openai_compatible.model" and set stance_provider.
"""
import argparse, json, os, random, sys, time
from concurrent.futures import wait
from transformers import AutoTokenizer
from fireworks.training.sdk import FiretitanServiceClient, FireworksClient, AdamParams, types
import requests

BASE = "accounts/fireworks/models/glm-5p3-flash"
TOKENIZER = "zai-org/GLM-5.3-Flash"
EOT = 154827  # <|user|> ends an assistant turn; it is in generation_config eos_token_id
EOS_IDS = [154820, 154827, 154829]
ACCOUNT = "accounts/furkan-6eo1n9w47cuf"  # shortcut: one hackathon account, read it from the API when a second account appears
KEY = os.environ["FIREWORKS_API_KEY"]

ap = argparse.ArgumentParser()
ap.add_argument("train"); ap.add_argument("holdout")
ap.add_argument("--smoke", action="store_true"); ap.add_argument("--epochs", type=int, default=2)
ap.add_argument("--lr", type=float, default=1e-4); ap.add_argument("--batch", type=int, default=4)
ap.add_argument("--rank", type=int, default=16); ap.add_argument("--model-id", default="groundswell-stance-v1")
ap.add_argument("--no-base-eval", action="store_true")
args = ap.parse_args()

def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)

tok = AutoTokenizer.from_pretrained(TOKENIZER)

def render(msgs):
    """prompt ids (ends with <think>) and completion ids (</think> + json + end of turn)."""
    prompt = tok.apply_chat_template(msgs[:2], tokenize=False, add_generation_prompt=True, reasoning_effort="low")
    p_ids = tok.encode(prompt, add_special_tokens=False)
    c_ids = tok.encode("</think>" + msgs[2]["content"], add_special_tokens=False) + [EOT]
    return p_ids, c_ids

def datum(p_ids, c_ids):
    ids = p_ids + c_ids
    w = [0.0] * len(p_ids) + [1.0] * len(c_ids)
    return types.Datum(model_input=types.ModelInput.from_ints(ids[:-1]), loss_fn_inputs={"target_tokens": ids[1:], "weights": w[1:]})

train = [json.loads(l)["messages"] for l in open(args.train)]
holdout = [json.loads(l)["messages"] for l in open(args.holdout)]
if args.smoke:
    train, holdout = train[:args.batch], holdout[:2]
rendered = [render(m) for m in train]
lens = [len(p) + len(c) for p, c in rendered]
log(f"train examples={len(train)} tokens={sum(lens)} max_len={max(lens)} holdout examples={len(holdout)}")

def expected(msgs):
    return {l["id"]: l for l in json.loads(msgs[2]["content"])["labels"]}

def parse(text):
    text = text.split("</think>")[-1]
    text = text[text.find("{"): text.rfind("}") + 1]
    return {l["id"]: l for l in json.loads(text)["labels"]}

def evaluate(sampler, name):
    """Agreement with the frontier labels per field on the holdout set."""
    futs = [sampler.sample(prompt=types.ModelInput.from_ints(render(m)[0]), num_samples=1,
                           sampling_params=types.SamplingParams(max_tokens=6000, temperature=0.0, stop=EOS_IDS)) for m in holdout]
    wait(futs)
    hit = {"stance": 0, "topic": 0, "emotion": 0}; n = 0; parsed = 0; bad = 0
    for m, f in zip(holdout, futs):
        exp = expected(m); n += len(exp)
        try:
            text = tok.decode(f.result().sequences[0].tokens)
            got = parse(text)
        except Exception as e:
            bad += 1; log(f"[{name}] unparsable sample: {str(e)[:120]}"); continue
        for id_, e in exp.items():
            g = got.get(id_)
            if not g: continue
            parsed += 1
            for k in hit: hit[k] += g.get(k) == e[k]
    res = {k: round(v / max(n, 1), 3) for k, v in hit.items()}
    log(f"[{name}] items={n} labeled={parsed} unparsable_examples={bad} agreement={res}")
    return {"items": n, "labeled": parsed, "unparsable_examples": bad, **res}

service = FiretitanServiceClient(api_key=KEY, base_url="https://api.fireworks.ai/training/v1/serverless")
tc = service.create_lora_training_client(base_model=BASE, rank=args.rank)
session = service.training_session_name
log(f"session={session} run={tc.run_id}")
results = {}

def publish(model_id):
    """Promote the newest sampler checkpoint to a model and load it on serverless. Done per epoch so an interrupted
    run still leaves a usable model."""
    fw = FireworksClient(api_key=KEY)
    rows = [r for r in fw.list_training_session_checkpoints(session) if r.get("promotable")]
    target = max(rows, key=lambda r: r["createTime"])
    log(f"promote {target['name']} -> {model_id}")
    model = fw.promote_session_checkpoint(name=target["name"], output_model_id=model_id, base_model=BASE)
    log(f"promoted: {json.dumps(model)[:300]}")
    h = {"Authorization": f"Bearer {KEY}"}
    for _ in range(60):
        m = requests.get(f"https://api.fireworks.ai/v1/{ACCOUNT}/models/{model_id}", headers=h).json()
        if m.get("state") == "READY": break
        log(f"model state {m.get('state')}"); time.sleep(10)
    dep = requests.post(f"https://api.fireworks.ai/v1/{ACCOUNT}/deployedModels", headers=h,
                        json={"model": f"{ACCOUNT}/models/{model_id}", "serverless": True})
    log(f"serverless load: {dep.status_code} {dep.text[:300]}")

try:
    step = 0
    for ep in range(1, args.epochs + 1):
        order = list(range(len(rendered))); random.Random(ep).shuffle(order)
        t_ep = time.time()
        for i in range(0, len(order), args.batch):
            batch = [datum(*rendered[j]) for j in order[i:i + args.batch]]
            t0 = time.time()
            fb = tc.forward_backward(batch, "cross_entropy").result()
            tc.optim_step(AdamParams(learning_rate=args.lr)).result()
            step += 1
            loss = getattr(fb, "loss", None) or getattr(fb, "metrics", None)
            log(f"ep{ep} step={step} loss={loss} dt={time.time() - t0:.1f}s")
            if args.smoke and step >= 1: break
        ckpt = f"ep{ep}" if not args.smoke else "smoke"
        path = tc.save_weights_for_sampler(ckpt).result().path
        log(f"epoch {ep} done in {time.time() - t_ep:.0f}s -> checkpoint {ckpt}: {path}")
        sampler = service.create_sampling_client(model_path=path, tokenizer=tok)
        results[ckpt] = evaluate(sampler, ckpt)
        sampler.close()
        if args.smoke: break
        publish(f"{args.model_id}-{ckpt}")
        json.dump(results, open("results.json", "w"), indent=1)

    if not args.no_base_eval:
        sampler = service.create_sampling_client(base_model=BASE, tokenizer=tok)
        results["base"] = evaluate(sampler, "base")
        sampler.close()
finally:
    try:
        FireworksClient(api_key=KEY).delete_training_session(session)
        log("session deleted")
    except Exception as e:
        log(f"session delete failed: {e}")
json.dump(results, open("results.json" if not args.smoke else "results-smoke.json", "w"), indent=1)
log("results", json.dumps(results))
