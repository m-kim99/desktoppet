import asyncio
import httpx # Core fix: use an async HTTP client
from typing import List, Dict, Union
import json
import os
from pathlib import Path
from langchain_core.embeddings import Embeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_classic.retrievers import EnsembleRetriever
from langchain_community.retrievers import BM25Retriever
from langchain_core.documents import Document
from langchain_community.vectorstores import FAISS

from py.load_files import get_files_json
from py.get_setting import load_settings, base_path, KB_DIR
    
# --- Tiktoken cache settings (kept) ---
def get_tiktoken_cache_path():
    cache_path = os.path.join(base_path, "tiktoken_cache")
    os.makedirs(cache_path, exist_ok=True)
    return cache_path

os.environ["TIKTOKEN_CACHE_DIR"] = get_tiktoken_cache_path()
# ---------------------------------

# --- New: text-cleaning helper ---
def clean_text(text: str) -> str:
    """
    Clean the text, removing un-encodable Unicode surrogate characters.
    Fixes the 'utf-8' codec can't encode character ... surrogates not allowed error.
    """
    if not isinstance(text, str):
        return str(text)
    # encode('utf-8', 'ignore') drops invalid surrogate characters
    return text.encode('utf-8', 'ignore').decode('utf-8')


class MyOpenAICompatibleEmbeddings(Embeddings):
    """
    OpenAI-compatible embedding class that uses the httpx async client for non-blocking network requests.
    """
    def __init__(self, base_url: str, model: str, api_key: str = "empty"):
        self.base_url = base_url
        self.model = model
        self.api_key = api_key
        # Assumes base_url is already http://127.0.0.1:8000/minilm
        self.endpoint = f"{self.base_url}/embeddings"

    # --- Async core methods ---
    async def _aembed(self, texts: Union[str, List[str]]) -> List[Dict]:
        """Asynchronously send the embedding request and handle the response"""
        
        headers = {"Authorization": f"Bearer {self.api_key}"}
        json_data = {"model": self.model, "input": texts}
        
        # Send the request using httpx.AsyncClient
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                # Call the embedding endpoint
                response = await client.post(self.endpoint, headers=headers, json=json_data)
                
                # Check the HTTP status code
                response.raise_for_status() 
                
                return response.json()["data"]
                
            except httpx.HTTPStatusError as e:
                detail = e.response.json().get('detail', e.response.text) if e.response.text else 'Unknown error'
                raise RuntimeError(f"Embedding API HTTP Error {e.response.status_code}: {detail}")
            except Exception as e:
                raise ConnectionError(f"Embedding API connection failed: {e.__class__.__name__}: {e}")

    # --- LangChain-compatible synchronous methods ---
    def embed_query(self, text: str) -> List[float]:
        data = asyncio.run(self.aembed_query(text))
        return data

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        data = asyncio.run(self.aembed_documents(texts))
        return data

    # --- Expose async LangChain methods ---
    async def aembed_query(self, text: str) -> List[float]:
        data = await self._aembed(text)
        return data[0]["embedding"]

    async def aembed_documents(self, texts: List[str]) -> List[List[float]]:
        data = await self._aembed(texts)
        return [r["embedding"] for r in data]


def chunk_documents(results: List[Dict], cur_kb) -> List[Document]:
    """Chunk each file separately and add metadata"""
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=cur_kb["chunk_size"],
        chunk_overlap=cur_kb["chunk_overlap"],
        separators=["\n\n", "\n", "。", "！", "？", "!", "?", "."]
    )
    
    all_docs = []
    for doc in results:
        # Lightly clean before chunking too, to avoid text_splitter errors
        clean_content = clean_text(doc["content"])
        chunks = text_splitter.split_text(clean_content)
        for chunk in chunks:
            all_docs.append(Document(
                page_content=chunk,
                metadata={
                    "file_path": doc["file_path"],
                    "file_name": doc["file_name"],
                    "doc_id": f"{doc['file_path']}_{len(all_docs)}" 
                }
            ))
    return all_docs

# Core change: add fault tolerance and data cleaning
async def build_vector_store(docs: List[Document], kb_id, cur_kb: Dict, cur_vendor: str):
    """Build and save the dual index"""
    if not isinstance(docs, list) or not all(isinstance(d, Document) for d in docs):
        raise ValueError("Input must be a list of Document objects")
    
    kb_dir = Path(KB_DIR)
    kb_dir.mkdir(parents=True, exist_ok=True)
    save_dir = kb_dir / str(kb_id)
    save_dir.mkdir(parents=True, exist_ok=True)

    # ========== BM25 index build (fault-tolerant version) ==========
    try:
        bm25_path = save_dir / "bm25_index.json"
        
        if not docs:
            print("Warning: No documents provided for BM25.")
        else:
            # 1. Clean data to prevent Unicode errors
            clean_docs_data = []
            for doc in docs:
                clean_metadata = {
                    k: clean_text(v) if isinstance(v, str) else v 
                    for k, v in doc.metadata.items()
                }
                clean_docs_data.append({
                    "page_content": clean_text(doc.page_content),
                    "metadata": clean_metadata
                })

            # 2. Save (using clean_docs_data)
            await asyncio.to_thread(
                lambda: json.dump(
                    {"docs": clean_docs_data}, 
                    open(bm25_path, "w", encoding="utf-8", errors="ignore"), 
                    ensure_ascii=False
                )
            )
            print(f"BM25 index saved successfully for KB {kb_id}")

    except Exception as e:
        # Even if BM25 fails, only print a warning and don't abort the program
        print(f"⚠️ BM25 Index failed (Skipping): {str(e)}")
        # Try cleaning up possibly corrupted files
        if 'bm25_path' in locals() and bm25_path.exists():
            try:
                os.remove(bm25_path)
            except:
                pass

    # ========== Vector index build (using async client) ==========
    try:
        embeddings = MyOpenAICompatibleEmbeddings(
            model=cur_kb["model"],
            api_key=cur_kb["api_key"],
            base_url=cur_kb["base_url"],
        )
        
        batch_size = 20 
        vector_db = None
        
        for i in range(0, len(docs), batch_size):
            batch = docs[i:i+batch_size]
            
            # Use asyncio.to_thread to run synchronous FAISS methods
            if vector_db is None:
                vector_db = await asyncio.to_thread(FAISS.from_documents, batch, embeddings)
            else:
                await asyncio.to_thread(vector_db.add_documents, batch)
            
            print(f"Processed {min(i+batch_size, len(docs))}/{len(docs)} documents")
        
        # Final save
        if vector_db:
            await asyncio.to_thread(vector_db.save_local, folder_path=str(save_dir), index_name="index")
            print(f"Vector store saved successfully for KB {kb_id}")
        
    except Exception as e:
        raise RuntimeError(f"Vector store build failed: {str(e)}")


async def load_retrievers(kb_id, cur_kb, cur_vendor):
    """Load the dual retriever (with a fallback for missing BM25)"""
    kb_path = Path(KB_DIR) / str(kb_id)
    bm25_path = kb_path / "bm25_index.json"
    
    # 1. Try loading BM25
    bm25_retriever = None
    try:
        if bm25_path.exists():
            bm25_data = await asyncio.to_thread(json.load, open(bm25_path, "r", encoding="utf-8"))
            bm25_docs = [
                Document(page_content=doc["page_content"], metadata=doc["metadata"]) 
                for doc in bm25_data["docs"]
            ]
            if bm25_docs:
                bm25_retriever = await asyncio.to_thread(BM25Retriever.from_documents, bm25_docs)
                bm25_retriever.k = cur_kb["chunk_k"]
    except Exception as e:
        print(f"Error loading BM25 (will fallback): {e}")

    # 2. Load the vector retriever
    embeddings = MyOpenAICompatibleEmbeddings(
        model=cur_kb["model"],
        api_key=cur_kb["api_key"],
        base_url=cur_kb["base_url"],
    )
    
    vector_db = await asyncio.to_thread(
        FAISS.load_local,
        folder_path=str(kb_path),
        embeddings=embeddings,
        allow_dangerous_deserialization=True,
        index_name="index"
    )
    vector_retriever = vector_db.as_retriever(
        search_kwargs={"k": cur_kb["chunk_k"]}
    )

    # 3. If BM25 fails to load (e.g. skipped during a prior build), use the vector retriever instead
    # This way EnsembleRetriever effectively uses two VectorRetrievers and won't error
    if bm25_retriever is None:
        print("Fallback: Using Vector Retriever for BM25 slot.")
        bm25_retriever = vector_retriever

    return bm25_retriever, vector_retriever

async def query_vector_store(query: str, kb_id, cur_kb, cur_vendor):
    """Hybrid query using EnsembleRetriever"""
    bm25_retriever, vector_retriever = await load_retrievers(kb_id, cur_kb, cur_vendor)
    if "weight" not in cur_kb:
        cur_kb["weight"] = 0.5
        
    ensemble_retriever = EnsembleRetriever(
        retrievers=[bm25_retriever, vector_retriever],
        weights=[1 - cur_kb["weight"], cur_kb["weight"]],
    )
    
    # EnsembleRetriever.invoke is synchronous/blocking, so run it in a thread
    docs = await asyncio.to_thread(ensemble_retriever.invoke, query)
    
    # Format conversion
    return [{
        "content": doc.page_content,
        "metadata": doc.metadata,
    } for doc in docs]


async def process_knowledge_base(kb_id):
    """The full asynchronous knowledge-base processing flow"""
    settings = await load_settings()
    cur_kb = None
    providerId = None
    for kb in settings["knowledgeBases"]:
        if kb["id"] == kb_id:
            cur_kb = kb
            providerId = kb["providerId"]
            break
    cur_vendor = None
    for provider in settings["modelProviders"]:
        if provider["id"] == providerId:
            cur_vendor = provider["vendor"]
            break
    
    if not cur_kb:
        raise ValueError(f"Knowledge base {kb_id} not found in settings")
        
    processed_results = await get_files_json(cur_kb["files"])
    
    chunks = chunk_documents(processed_results, cur_kb)
    
    # Call the async version of build_vector_store
    await build_vector_store(chunks, kb_id, cur_kb, cur_vendor)

    return "Knowledge-base processing complete"

async def query_knowledge_base(kb_id, query: str):
    """Query the knowledge base"""
    settings = await load_settings()
    cur_kb = None
    providerId = None
    for kb in settings["knowledgeBases"]:
        if kb["id"] == kb_id:
            cur_kb = kb
            providerId = kb["providerId"]
            break
    cur_vendor = None
    for provider in settings["modelProviders"]:
        if provider["id"] == providerId:
            cur_vendor = provider["vendor"]
            break
    
    if not cur_kb:
        return f"Knowledge base {kb_id} not found in settings"
        
    # Call the async version of query_vector_store
    results = await query_vector_store(query, kb_id, cur_kb, cur_vendor)
    return results

async def rerank_knowledge_base(query: str , docs: List[Dict]) -> List[Dict]:
    settings = await load_settings()
    providerId = settings["KBSettings"]["selectedProvider"]
    cur_vendor = None
    for provider in settings["modelProviders"]:
        if provider["id"] == providerId:
            cur_vendor = provider["vendor"]
            break
    if cur_vendor == "jina":
        jina_api_key = settings["KBSettings"]["api_key"]
        model_name = settings["KBSettings"]["model"]
        top_n = settings["KBSettings"]["top_n"]
        documents = [doc.get("content", "") for doc in docs]
        url = settings["KBSettings"]["base_url"] + "/rerank"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {jina_api_key}"
        }
        data = {
            "model": model_name,
            "query": query,
            "top_n": top_n,
            "documents": documents,
            "return_documents": False
        }
        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, json=data)
        if response.status_code != 200:
            raise Exception(f"Jina reranking failed: {response.text}")
        result = response.json()
        ranked_indices = [item['index'] for item in result.get('results', [])]
        ranked_docs = [docs[i] for i in ranked_indices]
        return ranked_docs
    elif cur_vendor == "Vllm":
        model_name = settings["KBSettings"]["model"]
        top_n = settings["KBSettings"]["top_n"]
        documents = [doc.get("content", "") for doc in docs]
        url = settings["KBSettings"]["base_url"] + "/rerank"
        headers = {"accept": "application/json", "Content-Type": "application/json"}
        data = {
            "model": model_name,
            "query": query,
            "top_n": top_n,
            "documents": documents,
        }
        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, json=data)
        if response.status_code != 200:
            raise Exception(f"Vllm reranking failed: {response.text}")
        result = response.json()
        ranked_indices = [item['index'] for item in result.get('results', [])]
        ranked_docs = [docs[i] for i in ranked_indices]
        return ranked_docs
    else:
        return docs

kb_tool = {
    "type": "function",
    "function": {
        "name": "query_knowledge_base",
        "description": f"Get knowledge-base information for the corresponding ID via natural language. When answering, list the information sources at the bottom of your answer, as links in the format [file_name](file_path). file_path can be an external resource or a resource on 127.0.0.1. When returning links, do not put spaces inside the (). If you need citation-to-footnote jump links, use the markdown syntax `[^1]` at the end of the sentence with the footnote `[^1]: [file_name](file_path)`.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The question to search for.",
                },
                "kb_id": {
                    "type": "string",
                    "description": "The knowledge base ID."
                }
            },
            "required": ["kb_id","query"],
        },
    },
}