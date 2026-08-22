def hydrate_template(template: str, prospect: dict) -> str:
    """
    Replace placeholders like {{name}}, {{company}}, {{title}} with prospect data.
    """
    if not template:
        return ""
        
    result = template
    name = prospect.get("name") or "there"
    company = prospect.get("company") or "your company"
    title = prospect.get("title") or "your role"
    
    # Simple replace
    result = result.replace("{{name}}", name)
    result = result.replace("{{company}}", company)
    result = result.replace("{{title}}", title)
    
    return result
