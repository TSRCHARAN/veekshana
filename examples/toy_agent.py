"""Toy research agent instrumented with Veekshana.

Runs with NO API keys: LLM calls are mocked, but each one is recorded as a real
"llm" span with model, tokens, and cost — so you get realistic traces to explore.

Usage:
    python toy_agent.py
"""

from __future__ import annotations

import random
import re
import time

import veekshana

veekshana.init()  # defaults: http://localhost:8787, api_key "dev-key"


# --- Mock LLM (stands in for a real Anthropic call; real calls are auto-captured) ---

def _mock_reply(prompt: str) -> str:
    """Realistic canned replies, so traces are meaningful to read — and so an
    LLM judge (veekshana-eval) has something real to evaluate."""
    if prompt.startswith("Plan the collections outreach"):
        return ("1) Pull the customer's overdue invoices. 2) Check payment history. "
                "3) Draft a courteous reminder naming the exact amount and due date.")
    if "CRM is down" in prompt:
        return ("Dear customer, we're experiencing a temporary systems issue and will "
                "follow up with your account details shortly. Apologies for the delay.")
    if prompt.startswith("Draft a polite payment reminder"):
        amount = re.search(r"'amount_inr': (\d+)", prompt)
        customer = re.search(r"'customer_id': '([^']+)'", prompt)
        name = customer.group(1) if customer else "customer"
        # One draft deliberately omits the amount — run veekshana-eval with
        # --criteria "...includes the exact overdue amount" and watch it get caught.
        if name.endswith("3") or not amount:
            return (f"Dear {name}, this is a friendly reminder that your account has an "
                    "outstanding balance. Please clear it at your earliest convenience. "
                    "Thank you for your business.")
        rupees = f"₹{int(amount.group(1)):,}"
        return (f"Dear {name}, this is a gentle reminder that {rupees} is overdue on your "
                f"account. We'd appreciate payment at your earliest convenience — the "
                f"payment link is below. If you've already paid, please disregard this "
                f"note. Thank you for your continued partnership.")
    return f"Acknowledged: {prompt[:80]}"


@veekshana.observe(name="llm.mock_claude", span_type="llm")
def mock_llm(prompt: str) -> str:
    time.sleep(random.uniform(0.05, 0.3))  # simulate latency
    reply = _mock_reply(prompt)
    input_tokens = len(prompt.split()) * 2
    output_tokens = len(reply.split()) * 2
    veekshana.update_current_span(
        model="claude-sonnet-5-5",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=(input_tokens * 2.0 + output_tokens * 10.0) / 1_000_000,
    )
    return reply


# --- Tools ---

@veekshana.observe(span_type="tool")
def search_web(query: str) -> list[str]:
    time.sleep(random.uniform(0.02, 0.1))
    return [f"result {i} for '{query}'" for i in range(3)]


@veekshana.observe(span_type="tool")
def fetch_invoice_data(customer_id: str) -> dict:
    time.sleep(random.uniform(0.02, 0.08))
    if random.random() < 0.15:
        raise RuntimeError(f"CRM timeout fetching {customer_id}")
    return {"customer_id": customer_id, "overdue_invoices": random.randint(1, 5), "amount_inr": random.randint(10_000, 500_000)}


# --- Agent ---

@veekshana.observe(name="collections_agent")
def run_agent(customer_id: str) -> str:
    plan = mock_llm(f"Plan the collections outreach for customer {customer_id}")
    try:
        invoices = fetch_invoice_data(customer_id)
    except RuntimeError:
        return mock_llm("The CRM is down. Draft an apology + retry plan.")
    context = search_web(f"payment behaviour {customer_id}")
    draft = mock_llm(f"Draft a polite payment reminder. Invoices: {invoices}. Context: {context}. Plan: {plan}")
    return draft


if __name__ == "__main__":
    veekshana.set_session("demo-session-001")
    for i in range(5):
        customer = f"CUST-{1000 + i}"
        print(f"→ running agent for {customer}")
        try:
            result = run_agent(customer)
            print(f"  {result[:80]}")
        except Exception as exc:
            print(f"  agent failed: {exc}")
    veekshana.flush()
    print("\nDone. Traces shipped to Veekshana → GET /api/v1/traces")
