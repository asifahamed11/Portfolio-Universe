"""Redact private submission details from public automation logs."""

PRIVATE_REVIEW_MARKER = "__private_submission_review_id"
PRIVATE_REVIEW_LABEL = "[private submission]"


def is_private_review(entry: object) -> bool:
    if not isinstance(entry, dict):
        return False
    marker = entry.get(PRIVATE_REVIEW_MARKER)
    return isinstance(marker, str) and bool(marker)


def safe_review_label(entry: object, public_label: object) -> str:
    if is_private_review(entry):
        return PRIVATE_REVIEW_LABEL
    return str(public_label)


def safe_review_error(entry: object, error: BaseException) -> str:
    if is_private_review(entry):
        return type(error).__name__
    return str(error)
