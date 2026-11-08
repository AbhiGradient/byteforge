#pragma once
#include <vector>

#include "algorithm.h"

namespace bf {


// Abstract intermediate class for graph algorithms (BFS, DFS, Dijkstra).
class GraphAlgorithm : public Algorithm {
public:
    static constexpr int kMaxNodes = 12;
    static constexpr int kMaxEdges = 40;

    GraphAlgorithm(const std::string& id, const std::string& name, Complexity complexity)
        : Algorithm({id, name, "graph", "graph", std::move(complexity)}) {}

    Json defaultInput() const override;
    ValidationResult validate(const Json& input) const override;
    Json run(const Json& input, StepRecorder& rec) const override;

protected:
    virtual bool requiresNonNegativeWeights() const { return false; }
    virtual Json traverse(const Graph& graph, int start, int target, StepRecorder& rec) const = 0;
};

class BreadthFirstSearch : public GraphAlgorithm {
public:
    BreadthFirstSearch() : GraphAlgorithm("bfs", "Breadth-First Search", {"O(V + E)", "O(V + E)", "O(V + E)", "O(V)"}) {}
protected:
    Json traverse(const Graph& graph, int start, int target, StepRecorder& rec) const override;
};

class DepthFirstSearch : public GraphAlgorithm {
public:
    DepthFirstSearch() : GraphAlgorithm("dfs", "Depth-First Search", {"O(V + E)", "O(V + E)", "O(V + E)", "O(V)"}) {}
protected:
    Json traverse(const Graph& graph, int start, int target, StepRecorder& rec) const override;
};

class DijkstraShortestPath : public GraphAlgorithm {
public:
    DijkstraShortestPath()
        : GraphAlgorithm("dijkstra", "Dijkstra's Algorithm", {"O((V + E) log V)", "O((V + E) log V)", "O((V + E) log V)", "O(V)"}) {}
protected:
    bool requiresNonNegativeWeights() const override { return true; }
    Json traverse(const Graph& graph, int start, int target, StepRecorder& rec) const override;
};

}  // namespace bf
