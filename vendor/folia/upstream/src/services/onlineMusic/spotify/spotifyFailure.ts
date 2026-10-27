import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineFailureDetail, OnlineFailureOperation } from '../../../types/onlineMusic';

// src/services/onlineMusic/spotify/spotifyFailure.ts
// What a Spotify request for a song's audio or a collection's tracks that failed hands to the
// shared rules (services/onlineMusic/failure/). What the desktop side's words for a failure mean is
// said here only (they are made in electron/spotify/). A network that fails and 5xx come as
// `network` and need nothing here.

// electron/spotify/errors.cjs gives Spotify's 429 this sentence, under the code of a network that fails.
const ASKED_TO_WAIT = 'Spotify asked to wait before trying again';

export const describeSpotifyFailure = (_operation: OnlineFailureOperation, error: unknown): OnlineFailureDetail | null => (
    error instanceof OnlineProviderError && error.providerId === 'spotify' && error.code === 'network' && error.message === ASKED_TO_WAIT
        ? { case: 'retry-later', httpStatus: 429 }
        : null
);
