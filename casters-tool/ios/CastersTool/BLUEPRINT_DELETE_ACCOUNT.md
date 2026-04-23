# Blueprint: Delete Account Feature (iOS)
### For XCode Claude — implement this feature end-to-end in the Xcode project

---

## Overview

Apple App Store Guideline 5.1.1 requires that any app with account creation must offer
in-app account deletion. This blueprint wires the `mark_account_deleted` Supabase RPC
(already live in production) into the iOS app.

The backend performs a **soft delete**: PII is wiped immediately, the `profiles` row gets
`is_deleted = true`, and all sessions are invalidated. The `auth.users` row is hard-deleted
after a 30-day grace period by a server-side job.

---

## 1. Supabase Client Call

Add a dedicated async method to your Supabase service/manager layer:

```swift
/// Soft-deletes the current user's account.
/// Wipes PII server-side and invalidates all sessions.
/// The caller should sign out and clear local state after this returns.
func markAccountDeleted() async throws {
    // The RPC takes no arguments — auth.uid() is used server-side.
    try await supabase
        .rpc("mark_account_deleted")
        .execute()
        .value as Void   // return type is TEXT "ok"; discard it
}
```

> **Package requirement:** `supabase-swift` (already in the project).  
> The `.rpc(_:)` builder handles encoding; no body parameters needed.

---

## 2. ViewModel / Business Logic

Create (or extend) an `AccountViewModel`:

```swift
@MainActor
class AccountViewModel: ObservableObject {
    @Published var isDeletingAccount = false
    @Published var deletionError: String?
    @Published var accountDeleted = false

    private let supabaseService: SupabaseService   // your existing service type

    func deleteAccount() async {
        isDeletingAccount = true
        deletionError = nil
        defer { isDeletingAccount = false }

        do {
            try await supabaseService.markAccountDeleted()

            // Sign out locally — the server already invalidated the session.
            try await supabaseService.signOut()

            // Clear any cached user data (Keychain, UserDefaults, CoreData, etc.)
            LocalCache.clearAll()   // adapt to your cache layer

            accountDeleted = true
        } catch {
            deletionError = localizedMessage(for: error)
        }
    }

    private func localizedMessage(for error: Error) -> String {
        // Map Supabase Postgres error codes to user-facing strings
        let msg = error.localizedDescription
        if msg.contains("not_authenticated") {
            return "You must be signed in to delete your account."
        } else if msg.contains("account_not_found") {
            return "Account not found or already deleted."
        }
        return "Something went wrong. Please try again."
    }
}
```

---

## 3. UI — Settings / Profile Screen

Add a "Delete Account" button in the account/settings section of your app. It must show:

1. A confirmation dialog (Apple HIG: destructive actions require confirmation).
2. A loading state while the request is in flight.
3. Navigation back to the sign-in screen on success.

```swift
struct DeleteAccountButton: View {
    @StateObject private var viewModel = AccountViewModel(...)
    @State private var showConfirmation = false
    @EnvironmentObject var appState: AppState   // your top-level navigation state

    var body: some View {
        Button(role: .destructive) {
            showConfirmation = true
        } label: {
            if viewModel.isDeletingAccount {
                ProgressView()
            } else {
                Text("Delete Account")
            }
        }
        .disabled(viewModel.isDeletingAccount)
        .confirmationDialog(
            "Delete your account?",
            isPresented: $showConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete Account", role: .destructive) {
                Task { await viewModel.deleteAccount() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your personal information will be erased immediately. "
               + "This action cannot be undone.")
        }
        .alert("Error", isPresented: .constant(viewModel.deletionError != nil)) {
            Button("OK") { viewModel.deletionError = nil }
        } message: {
            Text(viewModel.deletionError ?? "")
        }
        .onChange(of: viewModel.accountDeleted) { deleted in
            if deleted { appState.navigateToSignIn() }
        }
    }
}
```

Place this view inside your existing Settings or Profile screen — NOT on a standalone screen.

---

## 4. Post-Deletion: Clear Local State

After the RPC succeeds, clear everything that could contain PII or stale session data:

| Storage              | Action                                              |
|----------------------|-----------------------------------------------------|
| Keychain             | Delete stored auth tokens / refresh token           |
| `UserDefaults`       | Remove display name, email, cached preferences      |
| CoreData / SwiftData | Delete user-scoped records if any                   |
| In-memory state      | Reset `AppState`, `@EnvironmentObject` user model   |

If you have a `LocalCache` or `SessionManager` singleton, call its `clearAll()` / `reset()`.

---

## 5. Navigation After Deletion

After local state is cleared, pop the entire navigation stack and route to your sign-in /
onboarding screen. Use your existing root navigation pattern:

```swift
// Example with a top-level AppState / NavigationPath
appState.navigateToSignIn()
// or
rootNavigationPath = NavigationPath()
appState.isAuthenticated = false
```

---

## 6. Placement in Settings UI

Apple Review looks for a clearly labeled **"Delete Account"** option. Recommended location:

```
Settings
└── Account
    ├── Edit Profile
    ├── Sign Out
    └── Delete Account   ← destructive, at bottom, labeled exactly this
```

A link in the app description or a web-only form is **not** sufficient for guideline 5.1.1.

---

## 7. Checklist Before Submitting to App Review

- [ ] "Delete Account" button is reachable within 3 taps from the main screen
- [ ] Confirmation dialog is shown before the action fires
- [ ] Loading indicator shown while the RPC is in flight
- [ ] App navigates to sign-in screen after successful deletion
- [ ] All local PII (Keychain, UserDefaults, in-memory) is cleared on success
- [ ] Error states are surfaced to the user with a dismissible alert
- [ ] Tested while signed out → should show "not_authenticated" error gracefully
- [ ] Tested with a real account → confirms profile row has `is_deleted = true` in Supabase

---

## Backend Reference (already live)

| Item                  | Detail                                      |
|-----------------------|---------------------------------------------|
| RPC name              | `mark_account_deleted`                      |
| Arguments             | none                                        |
| Returns               | `"ok"` (TEXT) on success                    |
| Auth required         | Yes — `authenticated` role only             |
| What it does          | Sets `profiles.is_deleted = true`, wipes `display_name` + `email` to `'DELETED'`, bumps `auth.users.updated_at` to invalidate all sessions |
| Hard-delete schedule  | `purge_deleted_accounts()` runs server-side after 30-day grace period |
