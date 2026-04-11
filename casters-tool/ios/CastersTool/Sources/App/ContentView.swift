// ContentView.swift — Adaptive root layout for Caster's Tool
// Pillar 1: iPad gets NavigationSplitView "Cockpit", iPhone gets TabView

import SwiftUI

struct ContentView: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var store = BroadcastStore()

    var body: some View {
        Group {
            if sizeClass == .regular {
                CockpitLayout()
            } else {
                CompactLayout()
            }
        }
        .environment(store)
        .task { await store.bootstrap() }
    }
}

// MARK: - iPad: Three-column NavigationSplitView

struct CockpitLayout: View {
    @Environment(BroadcastStore.self) private var store
    @State private var selectedTab: CockpitTab = .rankings

    var body: some View {
        @Bindable var store = store
        NavigationSplitView(columnVisibility: $store.columnVisibility) {
            // Sidebar — Event picker + status
            EventSidebarView()
                .navigationTitle("Events")
        } content: {
            // Middle — Rankings or Play-by-Play
            switch selectedTab {
            case .rankings:
                RankingsView()
            case .playByPlay:
                PlayByPlayView()
            case .breakdown:
                BreakdownView()
            }
        } detail: {
            // Right — Team lookup / inspector
            if let team = store.selectedTeam {
                TeamDetailView(team: team)
            } else {
                ContentUnavailableView(
                    "Select a Team",
                    systemImage: "person.3.fill",
                    description: Text("Tap a team in rankings or a match to inspect.")
                )
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                CockpitTabPicker(selection: $selectedTab)
            }
            ToolbarItem(placement: .topBarTrailing) {
                ConnectionStatusBadge()
            }
        }
    }
}

enum CockpitTab: String, CaseIterable, Identifiable {
    case rankings = "Rankings"
    case playByPlay = "Play-by-Play"
    case breakdown = "Breakdown"

    var id: String { rawValue }
    var icon: String {
        switch self {
        case .rankings: "list.number"
        case .playByPlay: "play.circle"
        case .breakdown: "chart.bar.xaxis"
        }
    }
}

struct CockpitTabPicker: View {
    @Binding var selection: CockpitTab

    var body: some View {
        Picker("View", selection: $selection) {
            ForEach(CockpitTab.allCases) { tab in
                Label(tab.rawValue, systemImage: tab.icon).tag(tab)
            }
        }
        .pickerStyle(.segmented)
    }
}

// MARK: - iPhone: Tab-based layout

struct CompactLayout: View {
    @Environment(BroadcastStore.self) private var store

    var body: some View {
        TabView {
            Tab("Rankings", systemImage: "list.number") {
                NavigationStack { RankingsView() }
            }
            Tab("PbP", systemImage: "play.circle") {
                NavigationStack { PlayByPlayView() }
            }
            Tab("Breakdown", systemImage: "chart.bar.xaxis") {
                NavigationStack { BreakdownView() }
            }
            Tab("Teams", systemImage: "magnifyingglass") {
                NavigationStack { TeamLookupView() }
            }
            Tab("Notes", systemImage: "note.text") {
                NavigationStack { NotesView() }
            }
        }
    }
}

// MARK: - Connection status indicator

struct ConnectionStatusBadge: View {
    @Environment(BroadcastStore.self) private var store

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(store.isConnected ? .green : .red)
                .frame(width: 8, height: 8)
            if !store.isConnected {
                Text("Offline")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .animation(.easeInOut, value: store.isConnected)
    }
}

// MARK: - Placeholder views (to be implemented)

struct EventSidebarView: View { var body: some View { Text("Events") } }
struct RankingsView: View { var body: some View { Text("Rankings") } }
struct PlayByPlayView: View { var body: some View { Text("Play-by-Play") } }
struct BreakdownView: View { var body: some View { Text("Breakdown") } }
struct TeamLookupView: View { var body: some View { Text("Team Lookup") } }
struct NotesView: View { var body: some View { Text("Notes") } }
struct TeamDetailView: View {
    let team: CachedTeam
    var body: some View { Text(team.nickname) }
}
