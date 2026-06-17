from app.modules.assistant import service


def test_tts_audio_bytes_caches_generated_audio(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "TTS_CACHE_DIR", tmp_path)
    monkeypatch.setattr(service, "_fetch_google_tts", lambda text: b"mp3-audio")

    audio = service.tts_audio_bytes("Bonjour ATLAS")

    assert audio == b"mp3-audio"
    assert len(list(tmp_path.glob("*.mp3"))) == 1


def test_tts_audio_bytes_uses_cache_without_network(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "TTS_CACHE_DIR", tmp_path)
    cache_path = service._tts_cache_path("Bonjour ATLAS")
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_bytes(b"cached-audio")

    def fail_network(text):
        raise AssertionError("network should not be called when cache exists")

    monkeypatch.setattr(service, "_fetch_google_tts", fail_network)

    assert service.tts_audio_bytes("Bonjour ATLAS") == b"cached-audio"


def test_tts_audio_bytes_raises_without_cache_or_network(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "TTS_CACHE_DIR", tmp_path)

    def fail_network(text):
        raise OSError("network down")

    monkeypatch.setattr(service, "_fetch_google_tts", fail_network)

    try:
        service.tts_audio_bytes("Bonjour ATLAS")
    except OSError as exc:
        assert "network down" in str(exc)
    else:
        raise AssertionError("Expected network error without cached audio")
