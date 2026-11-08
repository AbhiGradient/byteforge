#pragma once
#include <map>
#include <string>
#include <vector>

#include "algorithm.h"

namespace bf {

struct ParsedOp {
    std::string command;
    std::vector<long long> args;
    std::string text;
};

// Abstract intermediate class for operation-driven data structures. The input
// is a list of textual operations ("push 5", "insert_at 2 9", ...).
class StructureAlgorithm : public Algorithm {
public:
    static constexpr std::size_t kMaxOps = 30;
    static constexpr int kMaxNodes = 10;

    StructureAlgorithm(const std::string& id, const std::string& name, Complexity complexity)
        : Algorithm({id, name, "structure", "structure", std::move(complexity)}) {}

    ValidationResult validate(const Json& input) const override;
    Json run(const Json& input, StepRecorder& rec) const override;

protected:
    // command name -> number of integer arguments
    virtual std::map<std::string, int> grammar() const = 0;
    virtual bool usesCapacity() const { return false; }
    virtual Json execute(const std::vector<ParsedOp>& ops, int capacity, StepRecorder& rec) const = 0;
};

class StackAlgorithm : public StructureAlgorithm {
public:
    StackAlgorithm() : StructureAlgorithm("stack", "Stack (LIFO)", {"O(1)", "O(1)", "O(1)", "O(n)"}) {}
    Json defaultInput() const override;
protected:
    std::map<std::string, int> grammar() const override;
    bool usesCapacity() const override { return true; }
    Json execute(const std::vector<ParsedOp>& ops, int capacity, StepRecorder& rec) const override;
};

class QueueAlgorithm : public StructureAlgorithm {
public:
    QueueAlgorithm() : StructureAlgorithm("queue", "Queue (FIFO, circular buffer)", {"O(1)", "O(1)", "O(1)", "O(n)"}) {}
    Json defaultInput() const override;
protected:
    std::map<std::string, int> grammar() const override;
    bool usesCapacity() const override { return true; }
    Json execute(const std::vector<ParsedOp>& ops, int capacity, StepRecorder& rec) const override;
};

class SinglyLinkedListAlgorithm : public StructureAlgorithm {
public:
    SinglyLinkedListAlgorithm()
        : StructureAlgorithm("singly_linked_list", "Singly Linked List", {"O(1)", "O(n)", "O(n)", "O(n)"}) {}
    Json defaultInput() const override;
protected:
    std::map<std::string, int> grammar() const override;
    Json execute(const std::vector<ParsedOp>& ops, int capacity, StepRecorder& rec) const override;
};

class DoublyLinkedListAlgorithm : public StructureAlgorithm {
public:
    DoublyLinkedListAlgorithm()
        : StructureAlgorithm("doubly_linked_list", "Doubly Linked List", {"O(1)", "O(n)", "O(n)", "O(n)"}) {}
    Json defaultInput() const override;
protected:
    std::map<std::string, int> grammar() const override;
    Json execute(const std::vector<ParsedOp>& ops, int capacity, StepRecorder& rec) const override;
};

class CircularLinkedListAlgorithm : public StructureAlgorithm {
public:
    CircularLinkedListAlgorithm()
        : StructureAlgorithm("circular_linked_list", "Circular Linked List", {"O(1)", "O(n)", "O(n)", "O(n)"}) {}
    Json defaultInput() const override;
protected:
    std::map<std::string, int> grammar() const override;
    Json execute(const std::vector<ParsedOp>& ops, int capacity, StepRecorder& rec) const override;
};

}  // namespace bf
