class ResourceNotFoundError(LookupError):
    """A resource is missing or intentionally hidden from the current actor."""


class ResourceStateError(ValueError):
    """A visible resource cannot perform the requested state transition."""

