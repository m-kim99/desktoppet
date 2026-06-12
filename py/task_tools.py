import asyncio
from typing import Optional, List
from py.task_center import get_task_center, TaskStatus
from py.sub_agent import run_subtask_in_background

# --- Tool Definitions ---

create_subtask_tool = {
    "type": "function",
    "function": {
        "name": "create_subtask",
        "description": "Create a subtask and run it asynchronously in the background. Supports publishing results to multiple channels.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "The subtask title. Do not mention which platform to send to here; specify that in platforms instead."},
                "description": {"type": "string", "description": "The detailed task goal. Do not mention which platform to send to in the goal; specify that in platforms instead. (Putting it in the goal would prevent the sub-agent from completing the task.)"},
                "task_type": {
                    "type": "string",
                    "enum": ["once", "time", "cycle"],
                    "default": "once"
                },
                "platforms": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["telegram", "discord", "slack"]
                    },
                    "description": "If you want to proactively push the result to a chat app after the task completes, specify it here",
                    "default": []
                },
                "trigger_config": {
                    "type": "object",
                    "properties": {
                        "timeValue": {"type": "string"},
                        "days": {"type": "array", "items": {"type": "integer"}},
                        "cycleValue": {"type": "string"},
                        "repeatNumber": {"type": "integer", "default": 1},
                        "isInfiniteLoop": {"type": "boolean", "default": True}
                    }
                },
                "agent_type": {"type": "string", "default": "default"}
            },
            "required": ["title", "description", "task_type"]
        }
    }
}

# (query_tasks_tool, cancel_subtask_tool, finish_task_tool unchanged...)
query_tasks_tool = {
    "type": "function",
    "function": {
        "name": "query_task_progress",
        "description": "Query task progress and results.",
        "parameters": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "parent_task_id": {"type": "string"},
                "status": {"type": "string", "enum": ["pending", "running", "completed", "failed", "cancelled"]},
                "verbose": {"type": "boolean", "default": False},
                "history_index": {"type": "integer", "default": -1}
            }
        }
    }
}

cancel_subtask_tool = {
    "type": "function",
    "function": {
        "name": "cancel_subtask",
        "description": "Cancel a task",
        "parameters": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"}
            },
            "required": ["task_id"]
        }
    }
}

finish_task_tool = {
    "type": "function",
    "function": {
        "name": "finish_task",
        "description": "Task-completion confirmation tool.",
        "parameters": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "result": {"type": "string"}
            },
            "required": ["task_id", "result"]
        }
    }
}

# --- Tool Implementations ---

async def create_subtask(
    title: str,
    description: str,
    task_type: str = "once",
    trigger_config: dict = None,
    agent_type: str = "default",
    workspace_dir: str = None,
    settings: dict = None,
    parent_task_id: Optional[str] = None,
    consensus_content: Optional[str] = None,
    platforms: List[str] = []
) -> str:
    try:
        task_center = await get_task_center(workspace_dir)
        actual_parent_id = parent_task_id or "MAIN_AGENT"
        context = {
            "task_type": task_type,
            "trigger_config": trigger_config or {},
            "platforms": platforms,
            "history": [],
            "results_history": [],
            "ran_count": 0
        }
        
        task = await task_center.create_task(
            title=title,
            description=description,
            parent_task_id=actual_parent_id,
            agent_type=agent_type,
            context=context,
            platforms=platforms # Pass in the platform list
        )
        
        if task_type == "once":
            asyncio.create_task(
                run_subtask_in_background(
                    task_id=task.task_id,
                    workspace_dir=workspace_dir,
                    settings=settings, 
                    consensus_content=consensus_content
                )
            )
            mode_msg = "Execution has started immediately."
        else:
            mode_msg = f"已进入计划清单，等待调度触发 (模式: {task_type})。"
            
    except Exception as e:
        return f"❌ 创建子任务失败: {str(e)}"
    
    return (f"✅ 子任务创建成功！\n\n"
            f"任务ID: {task.task_id}\n"
            f"标题: {task.title}\n"
            f"类型: {task_type}\n"
            f"渠道: {', '.join(platforms)}\n"
            f"状态: {mode_msg}")

async def query_task_progress(
    workspace_dir: str,
    task_id: Optional[str] = None,
    parent_task_id: Optional[str] = None,
    status: Optional[str] = None,
    verbose: bool = False,
    history_index: int = -1
) -> str:
    """Query task progress - enhanced version: supports deep retrospection of cyclic/scheduled tasks"""
    try:
        from py.task_center import get_task_center, TaskStatus
        task_center = await get_task_center(workspace_dir)
        
        tasks = []
        if task_id:
            single_task = await task_center.get_task(task_id)
            if single_task: tasks = [single_task]
            else: return f"❌ 未找到 ID 为 {task_id} 的任务。"
        else:
            status_enum = TaskStatus(status) if status else None
            tasks = await task_center.list_tasks(parent_task_id=parent_task_id, status=status_enum)

        if not tasks:
            return "📋 The task center currently has no relevant tasks."

        result_lines = [f"📋 任务中心状态报告 (共 {len(tasks)} 个任务)"]
        result_lines.append("-" * 40)

        for task in tasks:
            ctx = task.context or {}
            t_type = ctx.get("task_type", "once").upper()
            ran_count = ctx.get("ran_count", 0)
            
            # 1. Title and basic status line
            icon = "🔁" if t_type == "CYCLE" else "⏰" if t_type == "TIME" else "📄"
            status_icon = "✅" if task.status == TaskStatus.COMPLETED else "🔄" if task.status == TaskStatus.RUNNING else "⏳"
            result_lines.append(f"{status_icon} [{task.task_id}] {icon} {task.title}")
            
            display_platforms = task.platforms or ctx.get("platforms", [])
            platform_str = ", ".join(display_platforms) if display_platforms else "None"
            result_lines.append(f"   推送渠道: {platform_str}")

            # 2. Type and frequency info
            type_info = f"   类型: {t_type}"
            if t_type == "CYCLE":
                type_info += f" (间隔: {ctx.get('trigger_config', {}).get('cycleValue', 'N/A')})"
            elif t_type == "TIME":
                days = ctx.get('trigger_config', {}).get('days', [])
                type_info += f" (时间: {ctx.get('trigger_config', {}).get('timeValue', 'N/A')} 周几: {days if days else 'One-off'})"
            result_lines.append(type_info)

            # 3. Scheduling stats
            schedule_info = f"   运行统计: 已触发 {ran_count} 次"
            if ctx.get("next_run_at"):
                next_run = ctx.get("next_run_at").replace("T", " ")[:16]
                schedule_info += f" | 下次运行: {next_run}"
            result_lines.append(schedule_info)
            result_lines.append(f"   当前状态: {task.status.value.upper()} | 总进度: {task.progress}%")

            # 4. Result-content handling (core improvement)
            results_history = ctx.get("results_history", [])
            
            if task.status == TaskStatus.RUNNING:
                history = ctx.get("history", [])
                if history:
                    result_lines.append(f"   ⚡ 实时动态: {history[-1][:120]}...")

            elif task.status in [TaskStatus.COMPLETED, TaskStatus.PENDING] and ran_count > 0:
                if verbose:
                    # Try extracting a specific result from history
                    try:
                        target_record = results_history[history_index]
                        record_time = target_record.get("time", "").replace("T", " ")[:16]
                        result_lines.append(f"\n   🎯 第 {results_history.index(target_record)+1} 次执行产出 ({record_time}):")
                        result_lines.append(f"--- CONTENT START ---\n{target_record.get('result', 'No result content')}\n--- CONTENT END ---")
                    except (IndexError, TypeError):
                        result_lines.append(f"   ⚠️ None法找到索引为 {history_index} 的历史记录。")
                    
                    # If there are multiple history entries, show a simple index list
                    if len(results_history) > 1:
                        history_list = ", ".join([f"#{i}" for i in range(len(results_history))])
                        result_lines.append(f"   📜 可回溯记录索引: {history_list} (总计 {len(results_history)} 条)")
                else:
                    # Non-verbose mode shows the latest summary
                    last_res = results_history[-1].get("result", "") if results_history else task.result
                    summary = (last_res[:150] + "...") if last_res else "No content"
                    result_lines.append(f"   📝 最新结果摘要: {summary}")
                    if len(results_history) > 1:
                        result_lines.append(f"   💡 (该任务有 {len(results_history)} 条历史记录，使用 verbose=true 和 history_index 查询详情)")

            elif task.status == TaskStatus.FAILED:
                result_lines.append(f"   ❌ 错误信息: {task.error}")

            result_lines.append("") # Separate tasks with newlines

    except Exception as e:
        return f"❌ 查询任务进度失败: {str(e)}"

    return "\n".join(result_lines)

async def cancel_subtask(workspace_dir: str, task_id: str) -> str:
    """Cancel a subtask"""
    try:
        task_center = await get_task_center(workspace_dir)
        success = await task_center.cancel_task(task_id)
    except Exception as e:
        return f"❌ Cancel a task失败: {str(e)}"
    return f"✅ 任务 {task_id} 已取消" if success else f"❌ Cancel a task {task_id} 失败"

# New implementation: finish_task
async def finish_task(
    workspace_dir: str,
    task_id: str,
    result: str
) -> str:
    try:
        """The sub-agent calls this function to mark a task as complete"""
        task_center = await get_task_center(workspace_dir)
        
        # Force update to COMPLETED, progress 100, and save the final result
        success = await task_center.update_task_progress(
            task_id=task_id,
            progress=100,
            status=TaskStatus.COMPLETED,
            result=result
        )
    except Exception as e:
        return f"❌ 标记任务完成失败: {str(e)}"
    
    if success:
        return f"🎉 任务 {task_id} 已成功标记为完成！结果已保存。请停止后续操作。"
    else:
        return f"❌ 任务 {task_id} 状态更新失败（可能任务ID错误）。"