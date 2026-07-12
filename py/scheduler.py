import asyncio
import os
from datetime import datetime, timedelta
from py.task_center import get_task_center, TaskStatus
from py.sub_agent import run_subtask_in_background

class AgentScheduler:
    def __init__(self, settings_ref: dict):
        # Reference the global settings so changes to cc_path are seen in real time
        self.settings = settings_ref

    async def start_loop(self):
        print("⏰ [Scheduler] started, monitoring ready...")
        while True:
            try:
                workspace_dir = self.settings.get("CLISettings", {}).get("cc_path")
                if workspace_dir and os.path.exists(workspace_dir):
                    await self._scan_and_trigger(workspace_dir)
            except Exception as e:
                print(f"❌ [Scheduler] polling error: {e}")
            
            await asyncio.sleep(30) # Check once every 30 seconds

    async def _scan_and_trigger(self, workspace_dir):
        task_center = await get_task_center(workspace_dir)
        tasks = await task_center.list_tasks()
        now = datetime.now()
        current_time_hm = now.strftime("%H:%M") 
        current_weekday = now.isoweekday() 
        # Frontend uses Sunday=0, Monday=1...
        ui_weekday = 0 if current_weekday == 7 else current_weekday

        for task in tasks:
            # Only PENDING tasks participate in scheduling triggers
            if task.status != TaskStatus.PENDING:
                continue

            t_type = task.context.get("task_type")
            config = task.context.get("trigger_config", {})

            # --- 1. Scheduled mode (time) ---
            if t_type == "time":
                time_val = config.get("timeValue", "")[:5] # HH:mm
                days = config.get("days", []) # List of selected weekdays [1, 2, 3...]
                
                # Matching logic:
                # Case A: weekdays selected -> both weekday and time must match
                # Case B: no weekdays selected -> trigger whenever the time matches (treated as a one-off)
                should_trigger = False
                if days:
                    if ui_weekday in days and current_time_hm == time_val:
                        should_trigger = True
                else:
                    if current_time_hm == time_val:
                        should_trigger = True

                if should_trigger:
                    # Avoid retriggering within the same minute
                    if task.context.get("last_trigger_minute") != current_time_hm:
                        await self._execute(task, workspace_dir, {"last_trigger_minute": current_time_hm})

            # --- 2. Cycle mode (cycle) ---
            elif t_type == "cycle":
                next_run_str = task.context.get("next_run_at")
                
                # If no next-run time is set, initialize it
                if not next_run_str:
                    await self._update_next_cycle_time(task, workspace_dir)
                    continue

                try:
                    next_run_at = datetime.fromisoformat(next_run_str)
                    if now >= next_run_at:
                        # Check the run-count limit
                        is_infinite = config.get("isInfiniteLoop", True)
                        repeat_num = config.get("repeatNumber", 1)
                        ran_count = task.context.get("ran_count", 0)

                        if is_infinite or ran_count < repeat_num:
                            # Trigger execution
                            await self._execute(task, workspace_dir, {"ran_count": ran_count + 1})
                        else:
                            # Count reached; safely archive
                            await task_center.update_task_progress(task.task_id, 100, status=TaskStatus.COMPLETED)
                except:
                    continue

    async def _execute(self, task, workspace_dir, extra_context):
        """执行任务并更新状态"""
        print(f"🚀 [Scheduler] triggering task: {task.title} (ID: {task.task_id})")
        task_center = await get_task_center(workspace_dir)
        
        # Prepare a fresh round of logs
        history = task.context.get("history", [])
        run_count = extra_context.get("ran_count", task.context.get("ran_count", 0))
        
        separator = f"🚀 **Round {run_count if run_count > 0 else 1} Start!** ({datetime.now().strftime('%H:%M:%S')})\n"
        history.append(separator)

        # Immediately mark as running; progress must be the second positional argument
        await task_center.update_task_progress(
            task.task_id, 
            0, 
            status=TaskStatus.RUNNING, 
            context={**extra_context, "history": history}
        )

        # Execute asynchronously
        asyncio.create_task(
            run_subtask_in_background(
                task_id=task.task_id,
                workspace_dir=workspace_dir,
                settings=self.settings
            )
        )

    async def _update_next_cycle_time(self, task, workspace_dir):
        """初始化周期任务的下一次执行时间"""
        config = task.context.get("trigger_config", {})
        cycle_str = config.get("cycleValue", "01:00:00")
        
        try:
            h, m, s = map(int, cycle_str.split(':'))
            delta = timedelta(hours=h, minutes=m, seconds=s)
            next_run = datetime.now() + delta
            
            task_center = await get_task_center(workspace_dir)
            await task_center.update_task_progress(
                task.task_id,
                0,
                status=TaskStatus.PENDING,
                context={"next_run_at": next_run.isoformat()}
            )
        except:
            pass