"""薄能力注册与安全调用契约。"""

from patent_studio.capabilities.registry import (
    CapabilityAuthorizationError,
    CapabilityError,
    CapabilityInputError,
    CapabilityKind,
    CapabilityOutputError,
    CapabilityRegistrationError,
    CapabilityRegistry,
    CapabilityRisk,
    CapabilityScope,
    CapabilitySpec,
    CommandInput,
    CommandReceipt,
    InvocationContext,
    UnknownCapabilityError,
)

__all__ = [
    "CapabilityAuthorizationError",
    "CapabilityError",
    "CapabilityInputError",
    "CapabilityKind",
    "CapabilityOutputError",
    "CapabilityRegistrationError",
    "CapabilityRegistry",
    "CapabilityRisk",
    "CapabilityScope",
    "CapabilitySpec",
    "CommandInput",
    "CommandReceipt",
    "InvocationContext",
    "UnknownCapabilityError",
]
