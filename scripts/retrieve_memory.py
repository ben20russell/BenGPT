#!/usr/bin/env python3
"""
Retrieve top-k relevant memory chunks from local Chroma DB for a query.

Usage:
  python3 scripts/retrieve_memory.py "user query text"

Output (stdout JSON):
  {"chunks": ["...", "...", "..."]}
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import chromadb
from langchain_openai import AzureOpenAIEmbeddings

try:
    from langchain_chroma import Chroma
except Exception:  # pragma: no cover
    Chroma = None  # type: ignore[assignment]


COLLECTION_NAME = "ben_gpt_memory"
TOP_K = 3
ENV_CANDIDATES = [Path(".env.local"), Path("../.env.local"), Path(".env")]


def load_local_env_candidates() -> None:
    for env_path in ENV_CANDIDATES:
        if not env_path.exists():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'").strip('"')
            if key.startswith("AZURE_OPENAI_") and key not in os.environ:
                os.environ[key] = value
        return


def resolve_chroma_dir() -> Path:
    candidates = [
        Path.cwd() / "chroma_db",
        Path.cwd().parent / "chroma_db",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def get_required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def get_embedding_deployment() -> str:
    deployment = (
        os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT")
        or os.getenv("AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT")
        or os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME")
        or os.getenv("AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT_NAME")
        or os.getenv("AZURE_OPENAI_DEPLOYMENT")
    )
    if not deployment:
        raise RuntimeError(
            "Missing AZURE_OPENAI_EMBEDDING_DEPLOYMENT (or *_EMBEDDINGS_* / *_DEPLOYMENT_NAME variant)"
        )
    return deployment


def retrieve_chunks(user_query: str) -> list[str]:
    api_key = get_required_env("AZURE_OPENAI_API_KEY")
    endpoint = get_required_env("AZURE_OPENAI_ENDPOINT")
    api_version = get_required_env("AZURE_OPENAI_API_VERSION")
    embedding_deployment = get_embedding_deployment()
    chroma_dir = resolve_chroma_dir()

    embeddings = AzureOpenAIEmbeddings(
        azure_endpoint=endpoint,
        api_key=api_key,
        openai_api_version=api_version,
        azure_deployment=embedding_deployment,
        check_embedding_ctx_length=False,
    )

    if Chroma is not None:
        vectorstore = Chroma(
            collection_name=COLLECTION_NAME,
            embedding_function=embeddings,
            persist_directory=str(chroma_dir),
        )
        docs = vectorstore.similarity_search(user_query, k=TOP_K)
        return [doc.page_content.strip() for doc in docs if doc.page_content.strip()]

    client = chromadb.PersistentClient(path=str(chroma_dir))
    collection = client.get_or_create_collection(name=COLLECTION_NAME)
    query_vector = embeddings.embed_query(user_query)
    results = collection.query(query_embeddings=[query_vector], n_results=TOP_K)
    docs = (results.get("documents") or [[]])[0]
    return [doc.strip() for doc in docs if isinstance(doc, str) and doc.strip()]


def main() -> int:
    load_local_env_candidates()

    if len(sys.argv) < 2:
        print(json.dumps({"chunks": []}))
        return 0

    user_query = sys.argv[1].strip()
    if not user_query:
        print(json.dumps({"chunks": []}))
        return 0

    chunks = retrieve_chunks(user_query)
    print(json.dumps({"chunks": chunks}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
