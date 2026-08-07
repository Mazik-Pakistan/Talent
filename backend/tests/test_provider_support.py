from app.services.managed_learning_service import ManagedLearningService


def test_provider_name_normalization_and_slugging():
    service = ManagedLearningService()

    assert service._normalize_provider_name("  linkedIn learning  ") == "LinkedIn Learning"
    assert service._normalize_provider_name("microsoft learn") == "Microsoft Learn"
    assert service._provider_slug("LinkedIn Learning") == "linkedin-learning"
    assert service._provider_slug("Microsoft Learn") == "microsoft-learn"
