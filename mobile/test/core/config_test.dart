import 'package:flutter_test/flutter_test.dart';
import 'package:openmusic/core/config.dart';

void main() {
  group('normalizeServerOrigin', () {
    test('normalizes a valid origin and removes the trailing slash', () {
      expect(
        normalizeServerOrigin('https://music.example.com/ ', requireHttps: true),
        'https://music.example.com',
      );
    });

    test('rejects paths, queries, fragments, and credentials', () {
      for (final value in <String>[
        'https://music.example.com/path',
        'https://music.example.com?next=/room',
        'https://music.example.com/#section',
        'https://user:secret@music.example.com',
      ]) {
        expect(
          () => normalizeServerOrigin(value, requireHttps: false),
          throwsStateError,
        );
      }
    });

    test('requires HTTPS when requested', () {
      expect(
        () => normalizeServerOrigin('http://music.example.com', requireHttps: true),
        throwsStateError,
      );
    });
  });
}
