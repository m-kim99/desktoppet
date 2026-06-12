from py.get_setting import load_settings

async def auto_behavior(behaviorType="delay", time="00:00:00", prompt="", days=[], repeatNumber=1, isInfiniteLoop=False, platforms=["chat"]):
    # Load settings
    settings = await load_settings()
    
    # Build a new behavior item
    new_behavior = {
        "enabled": True,
        "platform": platforms[0] if platforms else "chat", # Compatible with the old single-field logic
        "platforms": platforms,                           # New field supporting multi-select
        "trigger": {
            "type": "time" if behaviorType == "time" else "cycle",
            "time":{
                "timeValue": time, 
                "days": days
            },
            "noInput":{
                "latency": 30, 
            },
            "cycle":{
                "cycleValue": time if behaviorType == "delay" else "00:00:30", 
                "repeatNumber": repeatNumber, 
                "isInfiniteLoop": isInfiniteLoop, 
            }
        },
        "action": {
            "type": "prompt",
            "prompt": "Time's up, "+prompt, 
            "random":{
                "events":[""],
                "type":"random",
                "orderIndex":0,
            }
        }
    }
    
    settings["behaviorSettings"]["behaviorList"].append(new_behavior)
    settings["behaviorSettings"]['enabled'] = True
    return settings


auto_behavior_tool = {
    "type": "function",
    "function": {
        "name": "auto_behavior",
        "description": "Use this when the user needs you to automatically perform certain actions at a specific time, after a delay, or on a specific channel. You can set a task to run simultaneously across multiple channels at once.",
        "parameters": {
            "type": "object",
            "properties": {
                "behaviorType": {
                    "type": "string",
                    "description": "Behavior type: time (run at a specific time point, e.g. 3 o'clock), delay (run after an interval, e.g. 5 minutes later)",
                    "enum": ["time", "delay"],
                },
                "time": {
                    "type": "string",
                    "description": "Time format HH:MM:SS. For the time type it is the execution point; for the delay type it is the interval.",
                },
                "prompt": {
                    "type": "string",
                    "description": "Task description, e.g.: remind the user about a meeting, send a greeting",
                },
                "days": {
                    "type": "array",
                    "description": "Effective for the time type. [1,2,3,4,5] means weekdays, [0] means Sunday, [] means no repeat",
                    "items": {
                        "type": "number",
                        "enum": [0, 1, 2, 3, 4, 5, 6],
                    },
                    "default": [],
                },
                "repeatNumber": {
                    "type": "number",
                    "description": "Number of repeats for the delay type (1-100)",
                    "minimum": 1,
                    "maximum": 100,
                    "default": 1,
                },
                "isInfiniteLoop": {
                    "type": "boolean",
                    "description": "Whether the delay type loops infinitely",
                    "default": False,
                },
                "platforms": {
                    "type": "array",
                    "description": "The list of channels to push to. chat: web conversation, telegram, discord, slack",
                    "items": {
                        "type": "string",
                        "enum": ["chat", "telegram", "discord", "slack"]
                    },
                    "default": ["chat"],
                }
            },
            "required": ["prompt", "behaviorType"],
        },
    },
}