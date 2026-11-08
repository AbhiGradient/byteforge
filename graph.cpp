#include "graph.h"

#include <algorithm>
#include <limits>
#include <set>

namespace bf {

namespace {

const long long kInf = std::numeric_limits<long long>::max() / 4;

// Snapshot builder shared by the graph algorithms. Every emitted step is
// self-contained: it carries the full traversal state at that moment.
class GraphTrace {
public:
    GraphTrace(StepRecorder& rec, int nodes, std::string frontierKind)
        : parent(static_cast<std::size_t>(nodes), -1), rec_(rec), kind_(std::move(frontierKind)) {}

    bool on() const { return rec_.enabled(); }

    void emit(int line, const std::string& type, const std::string& message) {
        Json d = Json::object();
        d["current"] = current;
        d["visited"] = Json::fromVector(visited);
        d["frontier"] = Json::fromVector(frontier);
        d["frontierKind"] = kind_;
        d["edge"] = edgeU >= 0 ? Json::array({edgeU, edgeV}) : Json();
        d["parent"] = Json::fromVector(parent);
        if (!dist.empty()) {
            Json arr = Json::array();
            for (long long v : dist) arr.push(v >= kInf ? Json() : Json(v));
            d["dist"] = arr;
        }
        d["path"] = Json::fromVector(path);
        rec_.emit(type, line, message, std::move(d));
    }

    void examine() {
        ++rec_.stats().comparisons;
        ++rec_.stats().operations;
    }
    void operation() { ++rec_.stats().operations; }

    int current = -1;
    int edgeU = -1, edgeV = -1;
    std::vector<int> visited, frontier, parent, path;
    std::vector<long long> dist;

private:
    StepRecorder& rec_;
    std::string kind_;
};

std::vector<int> pathTo(const std::vector<int>& parent, int target) {
    std::vector<int> path;
    for (int v = target; v != -1; v = parent[static_cast<std::size_t>(v)]) path.push_back(v);
    std::reverse(path.begin(), path.end());
    return path;
}

std::vector<int> unreached(const Graph& g, const std::vector<bool>& seen) {
    std::vector<int> out;
    for (int v = 0; v < g.nodes; ++v)
        if (!seen[static_cast<std::size_t>(v)]) out.push_back(v);
    return out;
}

#define STEP(type, msg) do { if (tr.on()) tr.emit(__LINE__, (type), (msg)); } while (0)
#define N(x) std::to_string(x)

}  // namespace

// ----------------------------- GraphAlgorithm -------------------------------

Json GraphAlgorithm::defaultInput() const {
    Json edges = Json::array({Json::array({0, 1, 4}), Json::array({0, 2, 2}), Json::array({1, 2, 5}),
                              Json::array({1, 3, 10}), Json::array({2, 4, 3}), Json::array({4, 3, 4}),
                              Json::array({3, 5, 11})});
    return Json::object({{"nodes", 6},
                         {"directed", false},
                         {"edges", edges},
                         {"start", 0},
                         {"target", info().id == "dijkstra" ? Json(5) : Json()}});
}

ValidationResult GraphAlgorithm::validate(const Json& input) const {
    Graph g;
    return InputValidator::graph(input, kMaxNodes, kMaxEdges, requiresNonNegativeWeights(), g);
}

Json GraphAlgorithm::run(const Json& input, StepRecorder& rec) const {
    Graph g;
    InputValidator::graph(input, kMaxNodes, kMaxEdges, requiresNonNegativeWeights(), g);
    int start = static_cast<int>(input["start"].asInt(0));
    int target = input["target"].isNumber() ? static_cast<int>(input["target"].asInt()) : -1;
    return traverse(g, start, target, rec);
}

// ==== BEGIN bfs ====
Json BreadthFirstSearch::traverse(const Graph& g, int start, int target, StepRecorder& rec) const {
    GraphTrace tr(rec, g.nodes, "queue");
    std::vector<bool> seen(static_cast<std::size_t>(g.nodes), false);
    std::vector<int> level(static_cast<std::size_t>(g.nodes), -1);
    std::vector<int>& queue = tr.frontier;
    seen[start] = true;
    level[start] = 0;
    queue.push_back(start);
    STEP("init", "Enqueue start node " + N(start));
    bool reached = false;
    while (!queue.empty()) {
        int u = queue.front();
        queue.erase(queue.begin());
        tr.current = u;
        tr.visited.push_back(u);
        STEP("visit", "Dequeue and visit node " + N(u));
        if (u == target) {
            reached = true;
            tr.path = pathTo(tr.parent, u);
            STEP("found", "Target " + N(u) + " reached in " + N(level[u]) + " edge(s)");
            break;
        }
        for (const auto& edge : g.adjacency[u]) {
            int v = edge.first;
            tr.edgeU = u;
            tr.edgeV = v;
            tr.examine();
            if (!seen[v]) {
                seen[v] = true;
                level[v] = level[u] + 1;
                tr.parent[v] = u;
                queue.push_back(v);
                STEP("discover", "Discover node " + N(v) + " from " + N(u) + " and enqueue it");
            } else {
                STEP("skip", "Node " + N(v) + " was already discovered");
            }
        }
        tr.edgeU = tr.edgeV = -1;
    }
    tr.current = -1;
    STEP("done", target >= 0 && !reached ? "Queue empty: target " + N(target) + " is unreachable" : "Traversal complete");
    return Json::object({{"order", Json::fromVector(tr.visited)},
                         {"levels", Json::fromVector(level)},
                         {"parent", Json::fromVector(tr.parent)},
                         {"path", Json::fromVector(tr.path)},
                         {"unreached", Json::fromVector(unreached(g, seen))},
                         {"targetReached", reached}});
}
// ==== END bfs ====

// ==== BEGIN dfs ====
static void dfsVisit(const Graph& g, int u, std::vector<bool>& seen, GraphTrace& tr, int target, bool& done) {
    seen[u] = true;
    tr.frontier.push_back(u);
    tr.visited.push_back(u);
    tr.current = u;
    STEP("visit", "Visit node " + N(u) + " (push onto the call stack)");
    if (u == target) {
        done = true;
        tr.path = tr.frontier;
        STEP("found", "Target " + N(u) + " found");
        return;
    }
    for (const auto& edge : g.adjacency[u]) {
        int v = edge.first;
        if (done) return;
        tr.edgeU = u;
        tr.edgeV = v;
        tr.examine();
        if (!seen[v]) {
            tr.parent[v] = u;
            STEP("explore", "Go deeper: " + N(u) + " -> " + N(v));
            dfsVisit(g, v, seen, tr, target, done);
            tr.current = u;
        } else {
            STEP("skip", "Node " + N(v) + " was already visited");
        }
    }
    if (done) return;
    tr.edgeU = tr.edgeV = -1;
    tr.frontier.pop_back();
    tr.current = tr.frontier.empty() ? -1 : tr.frontier.back();
    STEP("backtrack", "Node " + N(u) + " is finished, backtrack");
}

Json DepthFirstSearch::traverse(const Graph& g, int start, int target, StepRecorder& rec) const {
    GraphTrace tr(rec, g.nodes, "stack");
    std::vector<bool> seen(static_cast<std::size_t>(g.nodes), false);
    bool done = false;
    STEP("init", "Start depth-first search at node " + N(start));
    dfsVisit(g, start, seen, tr, target, done);
    tr.edgeU = tr.edgeV = -1;
    STEP("done", target >= 0 && !done ? "Search finished: target " + N(target) + " is unreachable" : "Traversal complete");
    return Json::object({{"order", Json::fromVector(tr.visited)},
                         {"parent", Json::fromVector(tr.parent)},
                         {"path", Json::fromVector(tr.path)},
                         {"unreached", Json::fromVector(unreached(g, seen))},
                         {"targetReached", done}});
}
// ==== END dfs ====

// ==== BEGIN dijkstra ====
Json DijkstraShortestPath::traverse(const Graph& g, int start, int target, StepRecorder& rec) const {
    GraphTrace tr(rec, g.nodes, "priority queue");
    std::vector<long long>& dist = tr.dist;
    dist.assign(static_cast<std::size_t>(g.nodes), kInf);
    std::vector<bool> settled(static_cast<std::size_t>(g.nodes), false);
    std::set<std::pair<long long, int>> pq;
    dist[start] = 0;
    pq.insert({0, start});
    tr.frontier = {start};
    STEP("init", "dist[" + N(start) + "] = 0, every other distance is infinity");
    bool reached = false;
    while (!pq.empty()) {
        auto top = *pq.begin();
        pq.erase(pq.begin());
        int u = top.second;
        long long d = top.first;
        settled[u] = true;
        tr.current = u;
        tr.visited.push_back(u);
        tr.frontier.clear();
        for (const auto& entry : pq) tr.frontier.push_back(entry.second);
        STEP("visit", "Settle node " + N(u) + " with shortest distance " + N(d));
        if (u == target) {
            reached = true;
            tr.path = pathTo(tr.parent, u);
            STEP("found", "Shortest distance to " + N(u) + " is " + N(d));
            break;
        }
        for (const auto& edge : g.adjacency[u]) {
            int v = edge.first;
            int w = edge.second;
            tr.edgeU = u;
            tr.edgeV = v;
            tr.examine();
            if (settled[v]) {
                STEP("skip", "Node " + N(v) + " is already settled");
            } else if (d + w < dist[v]) {
                if (dist[v] != kInf) pq.erase({dist[v], v});
                dist[v] = d + w;
                tr.parent[v] = u;
                pq.insert({dist[v], v});
                tr.frontier.clear();
                for (const auto& entry : pq) tr.frontier.push_back(entry.second);
                STEP("relax", "Relax " + N(u) + " -> " + N(v) + ": dist[" + N(v) + "] = " + N(d) + " + " + N(w) + " = " + N(dist[v]));
            } else {
                STEP("skip", "No improvement for node " + N(v) + " (" + N(d + w) + " >= " + N(dist[v]) + ")");
            }
        }
        tr.edgeU = tr.edgeV = -1;
    }
    tr.current = -1;
    tr.edgeU = tr.edgeV = -1;
    STEP("done", "Dijkstra finished");
    Json distances = Json::array();
    for (long long v : dist) distances.push(v >= kInf ? Json() : Json(v));
    return Json::object({{"dist", distances},
                         {"order", Json::fromVector(tr.visited)},
                         {"parent", Json::fromVector(tr.parent)},
                         {"path", Json::fromVector(tr.path)},
                         {"targetReached", reached},
                         {"unreached", Json::fromVector(unreached(g, std::vector<bool>(settled)))}});
}
// ==== END dijkstra ====

void registerGraphAlgorithms(AlgorithmManager& manager) {
    manager.add(std::make_unique<BreadthFirstSearch>());
    manager.add(std::make_unique<DepthFirstSearch>());
    manager.add(std::make_unique<DijkstraShortestPath>());
}

}  // namespace bf
