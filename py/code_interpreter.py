from e2b_code_interpreter import Sandbox
import asyncio
from concurrent.futures import ThreadPoolExecutor
from py.get_setting import load_settings

async def e2b_code(code: str, language: str = "Python") -> str:
    settings = await load_settings()
    e2b_api_key = settings["codeSettings"]["e2b_api_key"]
    executor = ThreadPoolExecutor()
    def run_in_sandbox():
        with Sandbox(api_key=e2b_api_key) as sandbox:
            execution = sandbox.run_code(code,language=language)
            return execution.logs

    # Run synchronous code in a thread pool to avoid blocking the event loop
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(executor, run_in_sandbox)
    return str(result)

import asyncio
from aiohttp import ClientSession


async def local_run_code(code: str, language: str = "python") -> str:
    settings = await load_settings()
    url = settings["codeSettings"]["sandbox_url"].strip("/") + "/run_code"
    headers = {
        "Content-Type": "application/json"
    }
    data = {
        "code": code,
        "language": language
    }

    async with ClientSession() as session:
        async with session.post(url, json=data, headers=headers) as response:
            # Get the response text
            result = await response.text()
            return result

e2b_code_tool = {
    "type": "function",
    "function": {
        "name": "e2b_code",
        "description": "Execute code; the tool only returns stdout and stderr. Print the answer you want to see to stdout.",
        "parameters": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "The code to execute, e.g.: print('Hello, World!'). Do not include markdown code-block markers! Provide only a runnable code string.",
                },
                "language": {
                    "type": "string",
                    "description": "The code language.",
                    "enum": ["python", "js", "ts", "r", "java", "bash"],
                    "default": "python"
                }
            },
            "required": ["code"],
        },
    },
}

local_run_code_tool = {
  "type": "function",
  "function": {
    "name": "local_run_code",
    "description": "Execute code; the tool only returns stdout and stderr. Print the answer you want to see to stdout.",
    "parameters": {
      "type": "object",
      "properties": {
        "code": {
          "type": "string",
          "description": "The code to execute, e.g.: print('Hello, World!'). Do not include markdown code-block markers! Provide only a runnable code string. The tool only returns stdout and stderr. Put the answer you want to see in print(), not anywhere else."
        },
        "language": {
          "type": "string",
          "description": "The code language.",
          "enum": [
            "python", "cpp", "nodejs", "go", "go_test", "java", "php", "csharp",
            "bash", "typescript", "sql", "rust", "cuda", "lua", "R", "perl",
            "D_ut", "ruby", "scala", "julia", "pytest", "junit", "kotlin_script",
            "jest", "verilog", "python_gpu", "lean", "swift", "racket"
          ],
          "default": "python"
        }
      },
      "required": ["code"]
    }
  }
}