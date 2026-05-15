# Passkey Authentication — iOS Blueprint

> **Purpose**: Wire Apple's native passkey APIs (`AuthenticationServices`) to the existing BFF passkey endpoints so users can sign in — and register new passkeys — without a password. Covers registration (post-OTP), discoverable sign-in, session persistence, and settings management.

---

## 1. Entry Points

| Trigger | Flow |
|---|---|
| App launch — no session in Keychain | `SignInSheet` (modal, non-dismissible) |
| App launch — session exists | Auto-refresh token → straight into main UI |
| `SignInSheet` — email with existing passkey | Tap "Sign in with Passkey" → email-prefilled assertion |
| `SignInSheet` — "Use Face ID / Touch ID" button | Discoverable (usernameless) assertion |
| Post-OTP success — no passkey registered | `PasskeySetupPrompt` sheet |
| Settings → "Manage Passkeys" → "Add Passkey" | Registration for already-signed-in user |

---

## 2. Infrastructure Prerequisite — Associated Domains

Passkeys are **only available on native iOS if** the app's bundle is linked to the RP domain via Apple's Associated Domains mechanism.

### 2a. Xcode Entitlement

In `CastersTool.entitlements` add:

```xml
<key>com.apple.developer.associated-domains</key>
<array>
    <string>webcredentials:casterstool.com</string>
</array>
```

### 2b. apple-app-site-association

Apple fetches this file from `https://casterstool.com/.well-known/apple-app-site-association` when the app is installed. Since the site isn't on GitHub Pages, **serve it directly from the FastAPI BFF** and point `casterstool.com` DNS at your BFF host (Fly.dev / Railway / etc.).

Add this route to `backend/app/main.py` **before** any catch-all or static mount:

```python
@app.get("/.well-known/apple-app-site-association", include_in_schema=False)
async def apple_app_site_association():
    return JSONResponse(
        content={
            "webcredentials": {
                "apps": ["458G3B5NLP.com.kleium.CastersTool"]
            }
        },
        media_type="application/json",
    )
```

Replace `TEAMID` with your 10-character Apple Team ID (visible in the Apple Developer portal under Membership).

The BFF env vars for native iOS **must** be:

```
PASSKEY_RP_ID  = casterstool.com
PASSKEY_ORIGIN = https://casterstool.com
```

The iOS SDK embeds this origin in every `clientDataJSON` it signs — it must exactly match what the server validates.

---

## 3. Backend API Endpoints

All endpoints are under `BFF_BASE_URL`. No direct Supabase calls.

| Method | Path | Auth header | Purpose |
|---|---|---|---|
| `GET` | `/auth/passkey/has-credential?email={email}` | None | Check before showing passkey button |
| `POST` | `/auth/passkey/register-options` | Bearer access_token | Get WebAuthn creation challenge |
| `POST` | `/auth/passkey/register` | Bearer access_token | Submit registration; server stores credential |
| `POST` | `/auth/passkey/authenticate-options` | None | Get assertion challenge (email known) |
| `POST` | `/auth/passkey/authenticate` | None | Submit assertion; server returns session |
| `POST` | `/auth/passkey/discover-options` | None | Get assertion challenge (usernameless) |
| `POST` | `/auth/passkey/discover-authenticate` | None | Submit discoverable assertion; server returns session |

### Session Response Shape

All authenticate endpoints return standard Supabase session JSON:

```json
{
  "access_token": "eyJ...",
  "refresh_token": "abc...",
  "token_type": "bearer",
  "expires_in": 3600,
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  }
}
```

---

## 4. Swift Models

```swift
// MARK: - Auth Session (persisted to Keychain)

struct AuthSession: Codable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
    let userId: String
    let email: String

    /// Wall-clock expiry derived from expiresIn at the time of decode.
    var expiresAt: Date

    enum CodingKeys: String, CodingKey {
        case accessToken  = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn    = "expires_in"
        case userId       = "user_id"
        case email
    }

    // Custom decode: derive expiresAt from expiresIn (seconds from now)
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        accessToken  = try c.decode(String.self, forKey: .accessToken)
        refreshToken = try c.decode(String.self, forKey: .refreshToken)
        expiresIn    = try c.decode(Int.self,    forKey: .expiresIn)
        // "user" nesting or flat field — handled in AuthSessionWrapper
        userId       = try c.decodeIfPresent(String.self, forKey: .userId) ?? ""
        email        = try c.decodeIfPresent(String.self, forKey: .email)  ?? ""
        expiresAt    = Date.now.addingTimeInterval(Double(expiresIn) - 60)
    }

    var isExpired: Bool { Date.now >= expiresAt }
}

/// Wrapper to handle Supabase's nested "user" object in the session response.
struct AuthSessionWrapper: Decodable {
    let session: AuthSession

    struct NestedUser: Decodable {
        let id: String
        let email: String?
    }

    private enum RootKeys: String, CodingKey {
        case accessToken  = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn    = "expires_in"
        case user
    }

    init(from decoder: Decoder) throws {
        let c    = try decoder.container(keyedBy: RootKeys.self)
        let user = try c.decodeIfPresent(NestedUser.self, forKey: .user)

        var patched = try decoder.singleValueContainer()
            .decode([String: AnyCodable].self)
        if let u = user {
            patched["user_id"] = AnyCodable(u.id)
            patched["email"]   = AnyCodable(u.email ?? "")
        }
        let patchedData = try JSONEncoder().encode(patched)
        session = try JSONDecoder().decode(AuthSession.self, from: patchedData)
    }
}

// MARK: - Passkey Credential (list in Settings)

struct PasskeyCredential: Codable, Identifiable {
    let id: String             // UUID primary key
    let credentialId: String
    let deviceName: String?
    let aaguid: String?
    let createdAt: String
    let lastUsedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case credentialId = "credential_id"
        case deviceName   = "device_name"
        case aaguid
        case createdAt    = "created_at"
        case lastUsedAt   = "last_used_at"
    }
}
```

---

## 5. BroadcastStore Additions

```swift
// In BroadcastStore
var session: AuthSession? = nil          // nil = signed out
var isSignedIn: Bool { session != nil }
var currentUserEmail: String? { session?.email }
```

Load on `bootstrap()`:

```swift
func bootstrap() async {
    session = KeychainHelper.loadSession()
    if let s = session, s.isExpired {
        await refreshSession()
    }
    // ... rest of bootstrap
}

func refreshSession() async {
    guard let s = session else { return }
    do {
        let fresh = try await APIService.shared.refreshToken(s.refreshToken)
        session = fresh
        KeychainHelper.saveSession(fresh)
    } catch {
        session = nil
        KeychainHelper.deleteSession()
    }
}

func signOut() {
    session = nil
    KeychainHelper.deleteSession()
}
```

---

## 6. KeychainHelper

```swift
enum KeychainHelper {
    private static let service = "com.kleium.CastersTool"
    private static let sessionKey = "authSession"

    static func saveSession(_ session: AuthSession) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        let query: [CFString: Any] = [
            kSecClass:       kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: sessionKey,
            kSecValueData:   data,
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    static func loadSession() -> AuthSession? {
        let query: [CFString: Any] = [
            kSecClass:            kSecClassGenericPassword,
            kSecAttrService:      service,
            kSecAttrAccount:      sessionKey,
            kSecReturnData:       true,
            kSecMatchLimit:       kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(AuthSession.self, from: data)
    }

    static func deleteSession() {
        let query: [CFString: Any] = [
            kSecClass:       kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: sessionKey,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
```

---

## 7. PasskeyManager

Central actor that owns all `AuthenticationServices` interactions. A single instance is held by `BroadcastStore`.

```swift
import AuthenticationServices

@MainActor
final class PasskeyManager: NSObject, ObservableObject {

    // The RP ID must match PASSKEY_RP_ID on the server and the
    // associated-domain entitlement: "casterstool.com".
    private let rpID: String

    private var continuation: CheckedContinuation<ASAuthorization, Error>?

    init(rpID: String) {
        self.rpID = rpID
    }

    // MARK: - Registration (signed-in user adds a passkey)

    /// Full registration flow.
    /// 1. Fetches creation options from the BFF (requires current access token).
    /// 2. Presents the system passkey sheet.
    /// 3. Submits the signed response to the BFF.
    func registerPasskey(
        email: String,
        deviceName: String?,
        accessToken: String,
        anchor: ASPresentationAnchor
    ) async throws {
        // Step 1: creation options
        let options = try await APIService.shared.passkeyRegisterOptions(
            email: email,
            deviceName: deviceName,
            accessToken: accessToken
        )

        // Step 2: system UI
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        let challenge = Data(base64URLEncoded: options.challenge)!
        let userIDData = options.user.id.data(using: .utf8)!

        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge,
            name: email,
            userID: userIDData
        )
        request.userVerificationPreference = .preferred

        let credential = try await performAuthorization(requests: [request], anchor: anchor)
        guard let reg = credential.credential as? ASAuthorizationPublicKeyCredentialRegistration else {
            throw PasskeyError.unexpectedCredentialType
        }

        // Step 3: submit to BFF
        let payload = buildRegistrationJSON(registration: reg)
        try await APIService.shared.passkeyRegister(
            email: email,
            credential: payload,
            deviceName: deviceName,
            accessToken: accessToken
        )
    }

    // MARK: - Email-prefilled assertion (email known)

    func authenticateWithPasskey(
        email: String,
        anchor: ASPresentationAnchor
    ) async throws -> AuthSession {
        // Step 1: assertion options (includes allowCredentials for this user)
        let options = try await APIService.shared.passkeyAuthOptions(email: email)
        guard options.hasPasskey else { throw PasskeyError.noPasskeyRegistered }

        let allowedCreds = options.allowCredentials.map { desc -> ASAuthorizationPlatformPublicKeyCredentialDescriptor in
            let idData = Data(base64URLEncoded: desc.id)!
            return ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: idData)
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        let challenge = Data(base64URLEncoded: options.challenge)!
        let request   = provider.createCredentialAssertionRequest(challenge: challenge)
        request.allowedCredentials      = allowedCreds
        request.userVerificationPreference = .preferred

        // Step 2: system UI
        let credential = try await performAuthorization(requests: [request], anchor: anchor)
        guard let assertion = credential.credential as? ASAuthorizationPublicKeyCredentialAssertion else {
            throw PasskeyError.unexpectedCredentialType
        }

        // Step 3: submit to BFF
        let payload = buildAssertionJSON(assertion: assertion)
        return try await APIService.shared.passkeyAuthenticate(email: email, credential: payload)
    }

    // MARK: - Discoverable (usernameless) sign-in

    func discoverAuthenticate(anchor: ASPresentationAnchor) async throws -> AuthSession {
        // Step 1: discover-options (empty allowCredentials)
        let options = try await APIService.shared.passkeyDiscoverOptions()

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        let challenge = Data(base64URLEncoded: options.challenge)!
        let request   = provider.createCredentialAssertionRequest(challenge: challenge)
        request.allowedCredentials = []   // discoverable
        request.userVerificationPreference = .preferred

        // Step 2: system UI
        let credential = try await performAuthorization(requests: [request], anchor: anchor)
        guard let assertion = credential.credential as? ASAuthorizationPublicKeyCredentialAssertion else {
            throw PasskeyError.unexpectedCredentialType
        }

        // Step 3: submit to BFF
        let payload = buildAssertionJSON(assertion: assertion)
        return try await APIService.shared.passkeyDiscoverAuthenticate(credential: payload)
    }

    // MARK: - Private helpers

    private func performAuthorization(
        requests: [ASAuthorizationRequest],
        anchor: ASPresentationAnchor
    ) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { cont in
            self.continuation = cont
            let controller = ASAuthorizationController(authorizationRequests: requests)
            controller.delegate = self
            controller.presentationContextProvider = WindowAnchorProvider(anchor: anchor)
            controller.performRequests()
        }
    }

    /// Constructs the WebAuthn registration JSON the BFF's py_webauthn expects.
    private func buildRegistrationJSON(
        registration: ASAuthorizationPublicKeyCredentialRegistration
    ) -> [String: Any] {
        let credID  = registration.credentialID.base64URLEncodedString()
        let attObj  = (registration.rawAttestationObject ?? Data()).base64URLEncodedString()
        let cdJSON  = registration.rawClientDataJSON.base64URLEncodedString()
        return [
            "id":    credID,
            "rawId": credID,
            "type":  "public-key",
            "response": [
                "clientDataJSON":    cdJSON,
                "attestationObject": attObj,
            ],
        ]
    }

    /// Constructs the WebAuthn assertion JSON the BFF's py_webauthn expects.
    private func buildAssertionJSON(
        assertion: ASAuthorizationPublicKeyCredentialAssertion
    ) -> [String: Any] {
        let credID   = assertion.credentialID.base64URLEncodedString()
        let authData = assertion.rawAuthenticatorData.base64URLEncodedString()
        let sig      = assertion.signature.base64URLEncodedString()
        let cdJSON   = assertion.rawClientDataJSON.base64URLEncodedString()
        var response: [String: Any] = [
            "clientDataJSON":  cdJSON,
            "authenticatorData": authData,
            "signature":       sig,
        ]
        if let uid = assertion.userID, !uid.isEmpty {
            response["userHandle"] = uid.base64URLEncodedString()
        }
        return [
            "id":       credID,
            "rawId":    credID,
            "type":     "public-key",
            "response": response,
        ]
    }
}

// MARK: - ASAuthorizationControllerDelegate

extension PasskeyManager: ASAuthorizationControllerDelegate {
    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        continuation?.resume(returning: authorization)
        continuation = nil
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}

// MARK: - Supporting Types

enum PasskeyError: LocalizedError {
    case noPasskeyRegistered
    case unexpectedCredentialType
    case cancelled

    var errorDescription: String? {
        switch self {
        case .noPasskeyRegistered:
            return "No passkey is registered for this account."
        case .unexpectedCredentialType:
            return "Unexpected credential type returned by the authenticator."
        case .cancelled:
            return "Sign-in was cancelled."
        }
    }
}

/// Bridges an `ASPresentationAnchor` (UIWindow) to the controller delegate protocol.
private final class WindowAnchorProvider: NSObject, ASAuthorizationControllerPresentationContextProviding {
    let anchor: ASPresentationAnchor
    init(anchor: ASPresentationAnchor) { self.anchor = anchor }
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { anchor }
}

// MARK: - Data base64url helpers

private extension Data {
    /// Decode base64url (URL-safe, no padding) → Data
    init?(base64URLEncoded string: String) {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder != 0 { base64 += String(repeating: "=", count: 4 - remainder) }
        self.init(base64Encoded: base64)
    }

    /// Encode Data → base64url (no padding)
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
```

---

## 8. APIService Additions

Add these methods to `APIService`. All passkey endpoints live at `/auth/passkey/…`.

```swift
// ── Response shapes ──────────────────────────────────────────────────────

struct PasskeyRegisterOptions: Decodable {
    struct User: Decodable {
        let id: String        // base64url user handle
        let name: String
        let displayName: String
    }
    let challenge: String     // base64url
    let user: User
    let timeout: Int?
}

struct PasskeyAuthOptions: Decodable {
    struct CredentialDescriptor: Decodable {
        let id: String        // base64url credential ID
        let type: String      // "public-key"
    }
    let hasPasskey: Bool
    let challenge: String
    let allowCredentials: [CredentialDescriptor]
    let timeout: Int?
}

struct PasskeyDiscoverOptions: Decodable {
    let challenge: String
    let timeout: Int?
}

// ── Methods ───────────────────────────────────────────────────────────────

extension APIService {

    func hasPasskeyCredential(email: String) async throws -> Bool {
        struct Resp: Decodable { let hasPasskey: Bool }
        let resp: Resp = try await get("/auth/passkey/has-credential",
                                       queryItems: [.init(name: "email", value: email)])
        return resp.hasPasskey
    }

    func passkeyRegisterOptions(
        email: String,
        deviceName: String?,
        accessToken: String
    ) async throws -> PasskeyRegisterOptions {
        var body: [String: String] = ["email": email]
        if let d = deviceName { body["device_name"] = d }
        return try await post("/auth/passkey/register-options",
                              body: body,
                              bearerToken: accessToken)
    }

    func passkeyRegister(
        email: String,
        credential: [String: Any],
        deviceName: String?,
        accessToken: String
    ) async throws {
        var body: [String: Any] = ["email": email, "credential": credential]
        if let d = deviceName { body["device_name"] = d }
        let _: EmptyResponse = try await post("/auth/passkey/register",
                                              bodyAny: body,
                                              bearerToken: accessToken)
    }

    func passkeyAuthOptions(email: String) async throws -> PasskeyAuthOptions {
        try await post("/auth/passkey/authenticate-options", body: ["email": email])
    }

    func passkeyAuthenticate(
        email: String,
        credential: [String: Any]
    ) async throws -> AuthSession {
        let wrapper: AuthSessionWrapper = try await post(
            "/auth/passkey/authenticate",
            bodyAny: ["email": email, "credential": credential]
        )
        return wrapper.session
    }

    func passkeyDiscoverOptions() async throws -> PasskeyDiscoverOptions {
        try await post("/auth/passkey/discover-options", body: [:] as [String: String])
    }

    func passkeyDiscoverAuthenticate(credential: [String: Any]) async throws -> AuthSession {
        let wrapper: AuthSessionWrapper = try await post(
            "/auth/passkey/discover-authenticate",
            bodyAny: ["credential": credential]
        )
        return wrapper.session
    }

    func refreshToken(_ refreshToken: String) async throws -> AuthSession {
        // Supabase token refresh via BFF proxy or directly against Supabase.
        // Endpoint: POST /auth/refresh   body: {"refresh_token": "..."}
        let wrapper: AuthSessionWrapper = try await post(
            "/auth/refresh",
            body: ["refresh_token": refreshToken]
        )
        return wrapper.session
    }
}
```

---

## 9. Sign-In Sheet

Non-dismissible modal shown when `!store.isSignedIn`. Supports:
- Email OTP (first-time / passkey-less users)
- Passkey sign-in (email known, has_credential = true)
- Discoverable / "Use Face ID / Touch ID" (usernameless)

```
SignInSheet
├── Logo + "Caster's Tool"
├── EmailField
├── CTAButton  ("Continue")
│   ├── has_credential? → "Sign in with Passkey"  (ASAuthorization assertion)
│   └── no credential  → "Send OTP"               (Supabase magic-link / OTP)
├── Divider "or"
└── BiometricButton   ("Use Face ID / Touch ID")  (discoverable assertion)
```

```swift
struct SignInSheet: View {
    @Environment(BroadcastStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase

    @State private var email = ""
    @State private var phase: SignInPhase = .emailEntry
    @State private var errorMessage: String? = nil
    @State private var isWorking = false

    enum SignInPhase {
        case emailEntry           // User types email
        case checkingCredential   // Querying has-credential
        case awaitingOTP          // OTP sent; user checks inbox
        case awaitingPasskey      // ASAuthorizationController sheet up
    }

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 24) {
                    Spacer(minLength: geo.size.height * 0.1)

                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .font(.system(size: 60))
                        .foregroundStyle(.tint)

                    Text("Caster's Tool")
                        .font(.largeTitle.bold())

                    if let err = errorMessage {
                        Label(err, systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                    }

                    VStack(spacing: 12) {
                        TextField("Email address", text: $email)
                            .keyboardType(.emailAddress)
                            .textContentType(.emailAddress)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .textFieldStyle(.roundedBorder)
                            .disabled(isWorking || phase == .awaitingOTP)

                        Button(action: handleContinue) {
                            Group {
                                if isWorking {
                                    ProgressView()
                                } else {
                                    Text(ctaLabel)
                                }
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(email.trimmingCharacters(in: .whitespaces).isEmpty || isWorking)
                    }

                    Divider().overlay(Text("or").font(.caption).foregroundStyle(.secondary))

                    Button(action: handleDiscoverable) {
                        Label("Use Face ID / Touch ID", systemImage: "faceid")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isWorking)
                }
                .padding(32)
            }
        }
        .interactiveDismissDisabled()
    }

    private var ctaLabel: String {
        switch phase {
        case .awaitingOTP: return "Resend Code"
        default:           return "Continue"
        }
    }

    @MainActor
    private func handleContinue() {
        errorMessage = nil
        isWorking = true
        Task {
            defer { isWorking = false }
            do {
                let hasPasskey = try await APIService.shared.hasPasskeyCredential(
                    email: email.trimmingCharacters(in: .whitespaces)
                )
                if hasPasskey {
                    try await signInWithPasskey()
                } else {
                    try await sendOTP()
                }
            } catch {
                handleError(error)
            }
        }
    }

    @MainActor
    private func handleDiscoverable() {
        errorMessage = nil
        isWorking = true
        Task {
            defer { isWorking = false }
            do {
                guard let window = UIApplication.shared.connectedScenes
                    .compactMap({ $0 as? UIWindowScene })
                    .first?.windows.first(where: { $0.isKeyWindow }) else { return }

                let session = try await store.passkeyManager.discoverAuthenticate(anchor: window)
                finalise(session: session)
            } catch {
                handleError(error)
            }
        }
    }

    @MainActor
    private func signInWithPasskey() async throws {
        phase = .awaitingPasskey
        guard let window = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first?.windows.first(where: { $0.isKeyWindow }) else { return }

        let session = try await store.passkeyManager.authenticateWithPasskey(
            email: email.trimmingCharacters(in: .whitespaces),
            anchor: window
        )
        finalise(session: session)
    }

    private func sendOTP() async throws {
        // POST /auth/otp  { email }  — standard Supabase magic-link
        try await APIService.shared.sendOTP(email: email.trimmingCharacters(in: .whitespaces))
        phase = .awaitingOTP
    }

    private func finalise(session: AuthSession) {
        store.session = session
        KeychainHelper.saveSession(session)
        phase = .emailEntry
    }

    private func handleError(_ error: Error) {
        let asErr = error as? ASAuthorizationError
        if asErr?.code == .canceled { return }   // user dismissed — silent
        errorMessage = error.localizedDescription
        phase = .emailEntry
    }
}
```

---

## 10. Post-OTP Passkey Setup Prompt

After an OTP sign-in succeeds, if no passkey is registered for the user, show this prompt once.

```swift
struct PasskeySetupPrompt: View {
    @Environment(BroadcastStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var isRegistering = false
    @State private var error: String? = nil
    @State private var done = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Image(systemName: "faceid")
                    .font(.system(size: 56))
                    .foregroundStyle(.tint)

                Text("Save a Passkey")
                    .font(.title2.bold())

                Text("Sign in faster next time with Face ID or Touch ID — no password needed.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)

                if let err = error {
                    Label(err, systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.red)
                }

                if done {
                    Label("Passkey saved!", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.headline)
                } else {
                    Button(action: register) {
                        Group {
                            if isRegistering {
                                ProgressView()
                            } else {
                                Label("Set Up Passkey", systemImage: "key.fill")
                            }
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isRegistering)

                    Button("Not Now") { dismiss() }
                        .foregroundStyle(.secondary)
                }
            }
            .padding(32)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    @MainActor
    private func register() {
        guard let token = store.session?.accessToken,
              let email = store.session?.email else { return }
        isRegistering = true
        error = nil
        Task {
            defer { isRegistering = false }
            do {
                guard let window = UIApplication.shared.connectedScenes
                    .compactMap({ $0 as? UIWindowScene })
                    .first?.windows.first(where: { $0.isKeyWindow }) else { return }
                try await store.passkeyManager.registerPasskey(
                    email: email,
                    deviceName: UIDevice.current.name,
                    accessToken: token,
                    anchor: window
                )
                done = true
                // Auto-dismiss after a beat
                try? await Task.sleep(for: .seconds(1.5))
                dismiss()
            } catch {
                let asErr = error as? ASAuthorizationError
                if asErr?.code == .canceled { return }
                self.error = error.localizedDescription
            }
        }
    }
}
```

---

## 11. Settings — Manage Passkeys Section

Shown inside the existing Settings/Profile sheet.

```swift
struct PasskeysSection: View {
    @Environment(BroadcastStore.self) private var store
    @State private var credentials: [PasskeyCredential] = []
    @State private var isLoading = false
    @State private var showAddSheet = false

    var body: some View {
        Section("Passkeys") {
            if isLoading {
                ProgressView()
            } else if credentials.isEmpty {
                Text("No passkeys registered.")
                    .foregroundStyle(.secondary)
                    .font(.subheadline)
            } else {
                ForEach(credentials) { cred in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(cred.deviceName ?? "Unknown device")
                            .font(.subheadline.bold())
                        Text("Added \(formatted(cred.createdAt))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let used = cred.lastUsedAt {
                            Text("Last used \(formatted(used))")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .onDelete(perform: delete)
            }

            Button {
                showAddSheet = true
            } label: {
                Label("Add Passkey", systemImage: "plus.circle")
            }
        }
        .task { await loadCredentials() }
        .sheet(isPresented: $showAddSheet) {
            PasskeySetupPrompt()
                .environment(store)
        }
    }

    private func loadCredentials() async {
        guard let token = store.session?.accessToken else { return }
        isLoading = true
        defer { isLoading = false }
        // GET /auth/passkey/credentials  (add this endpoint to BFF if needed)
        // For now, read via Supabase anon-key + RLS (users can SELECT their own rows).
        credentials = (try? await APIService.shared.listPasskeyCredentials(accessToken: token)) ?? []
    }

    private func delete(at offsets: IndexSet) {
        // DELETE /auth/passkey/credentials/{id}  (service-role via BFF)
        // Implement delete endpoint in BFF as needed.
    }

    private func formatted(_ iso: String) -> String {
        guard let d = ISO8601DateFormatter().date(from: iso) else { return iso }
        return d.formatted(date: .abbreviated, time: .omitted)
    }
}
```

---

## 12. Root Sheet Attachment

In `ContentView` (or the outermost view that's always alive):

```swift
.sheet(isPresented: Binding(
    get: { !store.isSignedIn },
    set: { _ in }
), content: {
    SignInSheet()
        .environment(store)
})
.sheet(isPresented: $store.showPasskeySetupPrompt) {
    PasskeySetupPrompt()
        .environment(store)
}
```

`showPasskeySetupPrompt` is set to `true` in `BroadcastStore` after a successful OTP sign-in when `has_credential == false`.

---

## 13. Files to Create / Modify

| File | Action |
|---|---|
| `Sources/Auth/PasskeyManager.swift` | **Create** — `ASAuthorizationController` wrapper |
| `Sources/Auth/KeychainHelper.swift` | **Create** — session persistence |
| `Sources/Auth/SignInSheet.swift` | **Create** — sign-in modal |
| `Sources/Auth/PasskeySetupPrompt.swift` | **Create** — post-OTP registration prompt |
| `Sources/Auth/PasskeysSection.swift` | **Create** — settings section |
| `Sources/Models/AuthModels.swift` | **Create** — `AuthSession`, `PasskeyCredential`, wrappers |
| `Sources/Stores/BroadcastStore.swift` | **Modify** — `session`, `isSignedIn`, `passkeyManager`, `showPasskeySetupPrompt` |
| `Sources/Services/APIService.swift` | **Modify** — passkey + token-refresh methods |
| `Sources/App/ContentView.swift` | **Modify** — attach `SignInSheet` and `PasskeySetupPrompt` sheets |
| `CastersTool.entitlements` | **Modify** — add `webcredentials:casterstool.com` |
| `backend/app/main.py` | **Modify** — add `/.well-known/apple-app-site-association` route |

---

## 14. Edge Cases

| Scenario | Behaviour |
|---|---|
| `ASAuthorizationError.canceled` | Silently ignore — user dismissed the system sheet |
| `has_credential == false` but user tries discoverable | Passkey sheet shows no saved passkeys; user cancels silently |
| Token expired on launch | `bootstrap()` calls `refreshSession()`; on failure clears session and shows `SignInSheet` |
| Registration challenge expires (90 s TTL) | py_webauthn returns 400 — surface "Session expired, try again" |
| Network offline during sign-in | `URLError.notConnectedToInternet` → show "No internet connection" |
| iOS < 16 | `ASAuthorizationPlatformPublicKeyCredentialProvider` unavailable; fall back to OTP-only; guard with `#available(iOS 16, *)` |
| Duplicate registration (same authenticator) | Server returns 409; surface "This device is already registered" |
| `dq` (delete account) | `BroadcastStore.signOut()` clears Keychain session; `SignInSheet` reappears |
