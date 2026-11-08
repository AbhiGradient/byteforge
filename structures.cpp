#include "structures.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <sstream>

namespace bf {

namespace {

std::string num(long long v) { return std::to_string(v); }

bool parseOp(const std::string& text, ParsedOp& out, std::string& error) {
    std::istringstream in(text);
    std::string token;
    out = ParsedOp{};
    out.text = text;
    if (!(in >> out.command)) {
        error = "Empty operation.";
        return false;
    }
    std::transform(out.command.begin(), out.command.end(), out.command.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    while (in >> token) {
        char* end = nullptr;
        long long v = std::strtoll(token.c_str(), &end, 10);
        if (*end != '\0') {
            error = "'" + token + "' in \"" + text + "\" is not an integer.";
            return false;
        }
        if (v < -999 || v > 999) {
            error = "Values in \"" + text + "\" must be between -999 and 999.";
            return false;
        }
        out.args.push_back(v);
    }
    return true;
}

// Emits events for the data-structure algorithms and keeps the operation log.
class StructTrace {
public:
    StructTrace(StepRecorder& rec, std::string kind) : rec_(rec), kind_(std::move(kind)) {}
    bool on() const { return rec_.enabled(); }
    void setOp(const std::string& op) { op_ = op; }
    void count() {
        ++rec_.stats().operations;
    }
    void compare() {
        ++rec_.stats().comparisons;
        ++rec_.stats().operations;
    }
    void write() {
        ++rec_.stats().writes;
        ++rec_.stats().operations;
    }
    void emit(int line, const std::string& type, const std::string& message, Json data) {
        data["kind"] = kind_;
        data["op"] = op_;
        rec_.emit(type, line, message, std::move(data));
    }
    void log(const std::string& message, bool ok, Json value = Json()) {
        entries_.push(Json::object({{"op", op_}, {"ok", ok}, {"message", message}, {"value", std::move(value)}}));
    }
    Json takeLog() { return entries_; }

private:
    StepRecorder& rec_;
    std::string kind_;
    std::string op_;
    Json entries_ = Json::array();
};

}  // namespace

#define SSTEP(type, msg, hl) do { if (trace_.on()) trace_.emit(__LINE__, (type), (msg), snapshot(hl)); } while (0)
#define XSTEP(obj, type, msg, hl) do { if (trace.on()) trace.emit(__LINE__, (type), (msg), (obj).snapshot(hl)); } while (0)
#define LSTEP(type, msg, cur, hl) do { if (trace_.on()) trace_.emit(__LINE__, (type), (msg), data((cur), (hl))); } while (0)

// --------------------------- StructureAlgorithm -----------------------------

ValidationResult StructureAlgorithm::validate(const Json& input) const {
    std::vector<std::string> raw;
    ValidationResult r = InputValidator::operations(input["ops"], kMaxOps, raw);
    if (!r.ok) return r;
    std::map<std::string, int> rules = grammar();
    for (const std::string& text : raw) {
        ParsedOp op;
        std::string error;
        if (!parseOp(text, op, error)) return ValidationResult::failure(error);
        auto it = rules.find(op.command);
        if (it == rules.end()) {
            std::string allowed;
            for (const auto& entry : rules) allowed += (allowed.empty() ? "" : ", ") + entry.first;
            return ValidationResult::failure("Unknown operation '" + op.command + "'. Allowed: " + allowed + ".");
        }
        if (static_cast<int>(op.args.size()) != it->second)
            return ValidationResult::failure("Operation '" + op.command + "' expects " + num(it->second) +
                                             " argument(s).");
    }
    if (usesCapacity() && input.has("capacity")) {
        long long cap = 0;
        r = InputValidator::integerInRange(input["capacity"], "capacity", 1, 10, cap);
        if (!r.ok) return r;
    }
    return ValidationResult::success();
}

Json StructureAlgorithm::run(const Json& input, StepRecorder& rec) const {
    std::vector<ParsedOp> ops;
    for (const Json& item : input["ops"].items()) {
        ParsedOp op;
        std::string error;
        parseOp(item.asString(), op, error);
        ops.push_back(op);
    }
    int capacity = static_cast<int>(input["capacity"].asInt(usesCapacity() ? 6 : kMaxNodes));
    return execute(ops, capacity, rec);
}

// ==== BEGIN stack ====
class IntStack {
public:
    IntStack(int capacity, StructTrace& trace) : data_(new int[capacity]), capacity_(capacity), trace_(trace) {}
    ~IntStack() { delete[] data_; }
    IntStack(const IntStack&) = delete;
    IntStack& operator=(const IntStack&) = delete;

    bool push(int value) {
        trace_.count();
        if (top_ + 1 == capacity_) {
            SSTEP("overflow", "Stack overflow: capacity " + num(capacity_) + " is full", -1);
            return false;
        }
        data_[++top_] = value;
        trace_.write();
        SSTEP("push", "Push " + num(value) + ": top moves to index " + num(top_), top_);
        return true;
    }
    bool pop(int& value) {
        trace_.count();
        if (top_ < 0) {
            SSTEP("underflow", "Stack underflow: nothing to pop", -1);
            return false;
        }
        value = data_[top_];
        SSTEP("pop", "Pop " + num(value) + " from index " + num(top_), top_);
        --top_;
        return true;
    }
    bool peek(int& value) const {
        trace_.count();
        if (top_ < 0) {
            SSTEP("underflow", "Stack is empty: nothing to peek", -1);
            return false;
        }
        value = data_[top_];
        SSTEP("peek", "Top element is " + num(value) + " (stack unchanged)", top_);
        return true;
    }
    int size() const { return top_ + 1; }
    std::vector<int> items() const { return std::vector<int>(data_, data_ + top_ + 1); }
    Json snapshot(int highlight) const {
        return Json::object({{"items", Json::fromVector(items())}, {"cap", capacity_}, {"hl", highlight}});
    }

private:
    int* data_;
    int capacity_;
    int top_ = -1;
    StructTrace& trace_;
};

Json StackAlgorithm::execute(const std::vector<ParsedOp>& ops, int capacity, StepRecorder& rec) const {
    StructTrace trace(rec, "stack");
    IntStack stack(capacity, trace);
    for (const ParsedOp& op : ops) {
        trace.setOp(op.text);
        int value = 0;
        bool ok = true;
        if (op.command == "push") {
            ok = stack.push(static_cast<int>(op.args[0]));
            trace.log(ok ? "pushed" : "overflow", ok, op.args[0]);
        } else if (op.command == "pop") {
            ok = stack.pop(value);
            trace.log(ok ? "popped" : "underflow", ok, ok ? Json(value) : Json());
        } else if (op.command == "peek") {
            ok = stack.peek(value);
            trace.log(ok ? "peeked" : "empty", ok, ok ? Json(value) : Json());
        } else if (op.command == "size") {
            XSTEP(stack, "size", "Size is " + num(stack.size()), -1);
            trace.log("size", true, stack.size());
        } else {
            XSTEP(stack, "isempty", stack.size() == 0 ? "The stack is empty" : "The stack is not empty", -1);
            trace.log(stack.size() == 0 ? "empty" : "not empty", true, stack.size() == 0);
        }
    }
    return Json::object({{"items", Json::fromVector(stack.items())}, {"size", stack.size()}, {"log", trace.takeLog()}});
}
// ==== END stack ====

// ==== BEGIN queue ====
class IntQueue {
public:
    IntQueue(int capacity, StructTrace& trace) : buffer_(new int[capacity]), capacity_(capacity), trace_(trace) {}
    ~IntQueue() { delete[] buffer_; }
    IntQueue(const IntQueue&) = delete;
    IntQueue& operator=(const IntQueue&) = delete;

    bool enqueue(int value) {
        trace_.count();
        if (count_ == capacity_) {
            SSTEP("overflow", "Queue overflow: all " + num(capacity_) + " slots are used", -1);
            return false;
        }
        int rear = (head_ + count_) % capacity_;
        buffer_[rear] = value;
        ++count_;
        trace_.write();
        SSTEP("enqueue", "Enqueue " + num(value) + " into slot " + num(rear) + " ((front + count) mod capacity)", rear);
        return true;
    }
    bool dequeue(int& value) {
        trace_.count();
        if (count_ == 0) {
            SSTEP("underflow", "Queue underflow: nothing to dequeue", -1);
            return false;
        }
        int freed = head_;
        value = buffer_[head_];
        head_ = (head_ + 1) % capacity_;
        --count_;
        SSTEP("dequeue", "Dequeue " + num(value) + " from slot " + num(freed) + ": front moves to slot " + num(head_), freed);
        return true;
    }
    bool front(int& value) const {
        trace_.count();
        if (count_ == 0) {
            SSTEP("underflow", "Queue is empty: no front element", -1);
            return false;
        }
        value = buffer_[head_];
        SSTEP("front", "Front element is " + num(value) + " (queue unchanged)", head_);
        return true;
    }
    int size() const { return count_; }
    std::vector<int> items() const {
        std::vector<int> out;
        for (int k = 0; k < count_; ++k) out.push_back(buffer_[(head_ + k) % capacity_]);
        return out;
    }
    Json snapshot(int highlight) const {
        Json slots = Json::array();
        for (int k = 0; k < capacity_; ++k) {
            bool used = ((k - head_ + capacity_) % capacity_) < count_;
            slots.push(used ? Json(buffer_[k]) : Json());
        }
        return Json::object({{"items", Json::fromVector(items())},
                             {"buffer", slots},
                             {"front", head_},
                             {"rear", (head_ + count_) % capacity_},
                             {"count", count_},
                             {"cap", capacity_},
                             {"hl", highlight}});
    }

private:
    int* buffer_;
    int capacity_;
    int head_ = 0;
    int count_ = 0;
    StructTrace& trace_;
};

Json QueueAlgorithm::execute(const std::vector<ParsedOp>& ops, int capacity, StepRecorder& rec) const {
    StructTrace trace(rec, "queue");
    IntQueue queue(capacity, trace);
    for (const ParsedOp& op : ops) {
        trace.setOp(op.text);
        int value = 0;
        bool ok = true;
        if (op.command == "enqueue") {
            ok = queue.enqueue(static_cast<int>(op.args[0]));
            trace.log(ok ? "enqueued" : "overflow", ok, op.args[0]);
        } else if (op.command == "dequeue") {
            ok = queue.dequeue(value);
            trace.log(ok ? "dequeued" : "underflow", ok, ok ? Json(value) : Json());
        } else if (op.command == "front") {
            ok = queue.front(value);
            trace.log(ok ? "front" : "empty", ok, ok ? Json(value) : Json());
        } else if (op.command == "size") {
            XSTEP(queue, "size", "Size is " + num(queue.size()), -1);
            trace.log("size", true, queue.size());
        } else {
            XSTEP(queue, "isempty", queue.size() == 0 ? "The queue is empty" : "The queue is not empty", -1);
            trace.log(queue.size() == 0 ? "empty" : "not empty", true, queue.size() == 0);
        }
    }
    return Json::object({{"items", Json::fromVector(queue.items())}, {"size", queue.size()}, {"log", trace.takeLog()}});
}
// ==== END queue ====

// ==== BEGIN singly_linked_list ====
class SinglyLinkedList {
public:
    explicit SinglyLinkedList(StructTrace& trace) : trace_(trace) {}
    ~SinglyLinkedList() {
        while (head_) {
            Node* next = head_->next;
            delete head_;
            head_ = next;
        }
    }
    SinglyLinkedList(const SinglyLinkedList&) = delete;
    SinglyLinkedList& operator=(const SinglyLinkedList&) = delete;

    std::size_t size() const { return size_; }

    bool insertHead(int value) {
        if (full()) return false;
        Node* node = new Node(value);
        node->next = head_;
        head_ = node;
        ++size_;
        LSTEP("insert", "Insert " + num(value) + " at the head: new node points to the old head", -1, 0);
        return true;
    }
    bool insertTail(int value) {
        if (full()) return false;
        Node* node = new Node(value);
        if (!head_) {
            head_ = node;
            ++size_;
            LSTEP("insert", "List was empty: new node becomes the head", -1, 0);
            return true;
        }
        Node* cur = head_;
        int idx = 0;
        LSTEP("traverse", "Start at the head", idx, -1);
        while (cur->next) {
            cur = cur->next;
            ++idx;
            trace_.count();
            LSTEP("traverse", "Move to the next node", idx, -1);
        }
        cur->next = node;
        ++size_;
        LSTEP("insert", "Last node now points to the new node", idx, idx + 1);
        return true;
    }
    bool insertAt(int position, int value) {
        if (position < 0 || position > static_cast<int>(size_)) {
            LSTEP("error", "Position " + num(position) + " is outside 0.." + num(size_), -1, -1);
            return false;
        }
        if (position == 0) return insertHead(value);
        if (full()) return false;
        Node* node = new Node(value);
        Node* prev = head_;
        LSTEP("traverse", "Start at the head", 0, -1);
        for (int idx = 1; idx < position; ++idx) {
            prev = prev->next;
            trace_.count();
            LSTEP("traverse", "Move to the next node", idx, -1);
        }
        node->next = prev->next;
        prev->next = node;
        ++size_;
        LSTEP("insert", "Splice the new node in after index " + num(position - 1), position - 1, position);
        return true;
    }
    bool remove(int value) {
        Node* prev = nullptr;
        Node* cur = head_;
        int idx = 0;
        while (cur) {
            trace_.compare();
            LSTEP("compare", "Compare node " + num(cur->value) + " with " + num(value), idx, -1);
            if (cur->value == value) {
                if (prev) prev->next = cur->next;
                else head_ = cur->next;
                delete cur;
                --size_;
                LSTEP("delete", "Unlink the node and free its memory", prev ? idx - 1 : -1, -1);
                return true;
            }
            prev = cur;
            cur = cur->next;
            ++idx;
        }
        LSTEP("missing", "Value " + num(value) + " is not in the list", -1, -1);
        return false;
    }
    int search(int value) const {
        int idx = 0;
        for (Node* cur = head_; cur; cur = cur->next, ++idx) {
            trace_.compare();
            LSTEP("compare", "Compare node " + num(cur->value) + " with " + num(value), idx, -1);
            if (cur->value == value) {
                LSTEP("found", "Found " + num(value) + " at index " + num(idx), idx, idx);
                return idx;
            }
        }
        LSTEP("missing", "Value " + num(value) + " is not in the list", -1, -1);
        return -1;
    }
    void traverse() const {
        int idx = 0;
        for (Node* cur = head_; cur; cur = cur->next, ++idx) {
            trace_.count();
            LSTEP("traverse", "Visit node " + num(cur->value), idx, -1);
        }
        LSTEP("done", "Reached nullptr: end of list", -1, -1);
    }
    std::vector<int> values() const {
        std::vector<int> out;
        for (Node* cur = head_; cur; cur = cur->next) out.push_back(cur->value);
        return out;
    }

private:
    struct Node {
        int value;
        Node* next;
        explicit Node(int v) : value(v), next(nullptr) {}
    };
    bool full() const {
        if (size_ < static_cast<std::size_t>(StructureAlgorithm::kMaxNodes)) return false;
        LSTEP("error", "List is limited to " + num(StructureAlgorithm::kMaxNodes) + " nodes in this lab", -1, -1);
        return true;
    }
    Json data(int cur, int hl) const {
        return Json::object({{"items", Json::fromVector(values())}, {"cur", cur}, {"hl", hl}});
    }
    Node* head_ = nullptr;
    std::size_t size_ = 0;
    StructTrace& trace_;
};

Json SinglyLinkedListAlgorithm::execute(const std::vector<ParsedOp>& ops, int, StepRecorder& rec) const {
    StructTrace trace(rec, "slist");
    SinglyLinkedList list(trace);
    for (const ParsedOp& op : ops) {
        trace.setOp(op.text);
        if (op.command == "insert_head") {
            bool ok = list.insertHead(static_cast<int>(op.args[0]));
            trace.log(ok ? "inserted at head" : "rejected", ok, op.args[0]);
        } else if (op.command == "insert_tail") {
            bool ok = list.insertTail(static_cast<int>(op.args[0]));
            trace.log(ok ? "inserted at tail" : "rejected", ok, op.args[0]);
        } else if (op.command == "insert_at") {
            bool ok = list.insertAt(static_cast<int>(op.args[0]), static_cast<int>(op.args[1]));
            trace.log(ok ? "inserted" : "rejected", ok, op.args[1]);
        } else if (op.command == "delete") {
            bool ok = list.remove(static_cast<int>(op.args[0]));
            trace.log(ok ? "deleted" : "not found", ok, op.args[0]);
        } else if (op.command == "search") {
            int at = list.search(static_cast<int>(op.args[0]));
            trace.log(at >= 0 ? "found" : "not found", at >= 0, at);
        } else {
            list.traverse();
            trace.log("traversed", true, Json::fromVector(list.values()));
        }
    }
    return Json::object({{"items", Json::fromVector(list.values())}, {"size", list.size()}, {"log", trace.takeLog()}});
}
// ==== END singly_linked_list ====

// ==== BEGIN doubly_linked_list ====
class DoublyLinkedList {
public:
    explicit DoublyLinkedList(StructTrace& trace) : trace_(trace) {}
    ~DoublyLinkedList() {
        while (head_) {
            Node* next = head_->next;
            delete head_;
            head_ = next;
        }
    }
    DoublyLinkedList(const DoublyLinkedList&) = delete;
    DoublyLinkedList& operator=(const DoublyLinkedList&) = delete;

    std::size_t size() const { return size_; }

    bool insertHead(int value) {
        if (full()) return false;
        Node* node = new Node(value);
        node->next = head_;
        if (head_) head_->prev = node;
        else tail_ = node;
        head_ = node;
        ++size_;
        LSTEP("insert", "Insert " + num(value) + " at the head: head->prev now points back to the new node", -1, 0);
        return true;
    }
    bool insertTail(int value) {
        if (full()) return false;
        Node* node = new Node(value);
        node->prev = tail_;
        if (tail_) tail_->next = node;
        else head_ = node;
        tail_ = node;
        ++size_;
        LSTEP("insert", "Insert " + num(value) + " at the tail in O(1) using the tail pointer", -1, static_cast<int>(size_) - 1);
        return true;
    }
    bool insertAt(int position, int value) {
        if (position < 0 || position > static_cast<int>(size_)) {
            LSTEP("error", "Position " + num(position) + " is outside 0.." + num(size_), -1, -1);
            return false;
        }
        if (position == 0) return insertHead(value);
        if (position == static_cast<int>(size_)) return insertTail(value);
        if (full()) return false;
        Node* cur = head_;
        LSTEP("traverse", "Start at the head", 0, -1);
        for (int idx = 1; idx <= position; ++idx) {
            cur = cur->next;
            trace_.count();
            LSTEP("traverse", "Move to the next node", idx, -1);
        }
        Node* node = new Node(value);
        node->prev = cur->prev;
        node->next = cur;
        cur->prev->next = node;
        cur->prev = node;
        ++size_;
        LSTEP("insert", "Relink prev and next pointers around the new node", position, position);
        return true;
    }
    bool remove(int value) {
        int idx = 0;
        for (Node* cur = head_; cur; cur = cur->next, ++idx) {
            trace_.compare();
            LSTEP("compare", "Compare node " + num(cur->value) + " with " + num(value), idx, -1);
            if (cur->value == value) {
                if (cur->prev) cur->prev->next = cur->next;
                else head_ = cur->next;
                if (cur->next) cur->next->prev = cur->prev;
                else tail_ = cur->prev;
                delete cur;
                --size_;
                LSTEP("delete", "Neighbours are linked to each other, node freed", -1, -1);
                return true;
            }
        }
        LSTEP("missing", "Value " + num(value) + " is not in the list", -1, -1);
        return false;
    }
    int search(int value) const {
        int idx = 0;
        for (Node* cur = head_; cur; cur = cur->next, ++idx) {
            trace_.compare();
            LSTEP("compare", "Compare node " + num(cur->value) + " with " + num(value), idx, -1);
            if (cur->value == value) {
                LSTEP("found", "Found " + num(value) + " at index " + num(idx), idx, idx);
                return idx;
            }
        }
        LSTEP("missing", "Value " + num(value) + " is not in the list", -1, -1);
        return -1;
    }
    std::vector<int> traverseForward() const {
        std::vector<int> out;
        int idx = 0;
        for (Node* cur = head_; cur; cur = cur->next, ++idx) {
            trace_.count();
            out.push_back(cur->value);
            LSTEP("traverse", "Forward: visit " + num(cur->value), idx, -1);
        }
        LSTEP("done", "Reached nullptr after the tail", -1, -1);
        return out;
    }
    std::vector<int> traverseBackward() const {
        std::vector<int> out;
        int idx = static_cast<int>(size_) - 1;
        for (Node* cur = tail_; cur; cur = cur->prev, --idx) {
            trace_.count();
            out.push_back(cur->value);
            LSTEP("traverse", "Backward: visit " + num(cur->value) + " using prev", idx, -1);
        }
        LSTEP("done", "Reached nullptr before the head", -1, -1);
        return out;
    }
    std::vector<int> values() const {
        std::vector<int> out;
        for (Node* cur = head_; cur; cur = cur->next) out.push_back(cur->value);
        return out;
    }

private:
    struct Node {
        int value;
        Node* prev;
        Node* next;
        explicit Node(int v) : value(v), prev(nullptr), next(nullptr) {}
    };
    bool full() const {
        if (size_ < static_cast<std::size_t>(StructureAlgorithm::kMaxNodes)) return false;
        LSTEP("error", "List is limited to " + num(StructureAlgorithm::kMaxNodes) + " nodes in this lab", -1, -1);
        return true;
    }
    Json data(int cur, int hl) const {
        return Json::object({{"items", Json::fromVector(values())}, {"cur", cur}, {"hl", hl}});
    }
    Node* head_ = nullptr;
    Node* tail_ = nullptr;
    std::size_t size_ = 0;
    StructTrace& trace_;
};

Json DoublyLinkedListAlgorithm::execute(const std::vector<ParsedOp>& ops, int, StepRecorder& rec) const {
    StructTrace trace(rec, "dlist");
    DoublyLinkedList list(trace);
    for (const ParsedOp& op : ops) {
        trace.setOp(op.text);
        if (op.command == "insert_head") {
            bool ok = list.insertHead(static_cast<int>(op.args[0]));
            trace.log(ok ? "inserted at head" : "rejected", ok, op.args[0]);
        } else if (op.command == "insert_tail") {
            bool ok = list.insertTail(static_cast<int>(op.args[0]));
            trace.log(ok ? "inserted at tail" : "rejected", ok, op.args[0]);
        } else if (op.command == "insert_at") {
            bool ok = list.insertAt(static_cast<int>(op.args[0]), static_cast<int>(op.args[1]));
            trace.log(ok ? "inserted" : "rejected", ok, op.args[1]);
        } else if (op.command == "delete") {
            bool ok = list.remove(static_cast<int>(op.args[0]));
            trace.log(ok ? "deleted" : "not found", ok, op.args[0]);
        } else if (op.command == "search") {
            int at = list.search(static_cast<int>(op.args[0]));
            trace.log(at >= 0 ? "found" : "not found", at >= 0, at);
        } else if (op.command == "traverse_back") {
            trace.log("traversed backward", true, Json::fromVector(list.traverseBackward()));
        } else {
            trace.log("traversed forward", true, Json::fromVector(list.traverseForward()));
        }
    }
    return Json::object({{"items", Json::fromVector(list.values())}, {"size", list.size()}, {"log", trace.takeLog()}});
}
// ==== END doubly_linked_list ====

// ==== BEGIN circular_linked_list ====
class CircularLinkedList {
public:
    explicit CircularLinkedList(StructTrace& trace) : trace_(trace) {}
    ~CircularLinkedList() {
        if (!tail_) return;
        Node* cur = tail_->next;
        tail_->next = nullptr;  // break the cycle before freeing
        while (cur) {
            Node* next = cur->next;
            delete cur;
            cur = next;
        }
    }
    CircularLinkedList(const CircularLinkedList&) = delete;
    CircularLinkedList& operator=(const CircularLinkedList&) = delete;

    std::size_t size() const { return size_; }

    bool insertHead(int value) {
        if (full()) return false;
        Node* node = new Node(value);
        if (!tail_) {
            node->next = node;
            tail_ = node;
        } else {
            node->next = tail_->next;
            tail_->next = node;
        }
        ++size_;
        LSTEP("insert", "Insert " + num(value) + " after the tail: it becomes the new head, the cycle stays closed", -1, 0);
        return true;
    }
    bool insertTail(int value) {
        if (full()) return false;
        Node* node = new Node(value);
        if (!tail_) {
            node->next = node;
        } else {
            node->next = tail_->next;
            tail_->next = node;
        }
        tail_ = node;
        ++size_;
        LSTEP("insert", "Insert " + num(value) + " as the new tail, tail->next points back to the head", -1, static_cast<int>(size_) - 1);
        return true;
    }
    bool remove(int value) {
        if (!tail_) {
            LSTEP("missing", "The list is empty", -1, -1);
            return false;
        }
        Node* prev = tail_;
        Node* cur = tail_->next;
        for (int idx = 0; idx < static_cast<int>(size_); ++idx) {
            trace_.compare();
            LSTEP("compare", "Compare node " + num(cur->value) + " with " + num(value), idx, -1);
            if (cur->value == value) {
                if (cur == prev) {
                    tail_ = nullptr;
                } else {
                    prev->next = cur->next;
                    if (cur == tail_) tail_ = prev;
                }
                delete cur;
                --size_;
                LSTEP("delete", "Node unlinked, the cycle is kept closed", -1, -1);
                return true;
            }
            prev = cur;
            cur = cur->next;
        }
        LSTEP("missing", "Value " + num(value) + " is not in the list, we are back at the head", -1, -1);
        return false;
    }
    int search(int value) const {
        if (!tail_) {
            LSTEP("missing", "The list is empty", -1, -1);
            return -1;
        }
        Node* cur = tail_->next;
        for (int idx = 0; idx < static_cast<int>(size_); ++idx, cur = cur->next) {
            trace_.compare();
            LSTEP("compare", "Compare node " + num(cur->value) + " with " + num(value), idx, -1);
            if (cur->value == value) {
                LSTEP("found", "Found " + num(value) + " at index " + num(idx), idx, idx);
                return idx;
            }
        }
        LSTEP("missing", "Completed one full lap without finding " + num(value), -1, -1);
        return -1;
    }
    void traverse() const {
        if (!tail_) {
            LSTEP("done", "The list is empty", -1, -1);
            return;
        }
        Node* cur = tail_->next;
        int idx = 0;
        do {
            trace_.count();
            LSTEP("traverse", "Visit node " + num(cur->value), idx, -1);
            cur = cur->next;
            ++idx;
        } while (cur != tail_->next);
        LSTEP("wrap", "next of the tail leads back to the head: one full lap completed", 0, -1);
    }
    std::vector<int> values() const {
        std::vector<int> out;
        if (!tail_) return out;
        Node* cur = tail_->next;
        do {
            out.push_back(cur->value);
            cur = cur->next;
        } while (cur != tail_->next);
        return out;
    }

private:
    struct Node {
        int value;
        Node* next;
        explicit Node(int v) : value(v), next(nullptr) {}
    };
    bool full() const {
        if (size_ < static_cast<std::size_t>(StructureAlgorithm::kMaxNodes)) return false;
        LSTEP("error", "List is limited to " + num(StructureAlgorithm::kMaxNodes) + " nodes in this lab", -1, -1);
        return true;
    }
    Json data(int cur, int hl) const {
        return Json::object({{"items", Json::fromVector(values())}, {"cur", cur}, {"hl", hl}});
    }
    Node* tail_ = nullptr;
    std::size_t size_ = 0;
    StructTrace& trace_;
};

Json CircularLinkedListAlgorithm::execute(const std::vector<ParsedOp>& ops, int, StepRecorder& rec) const {
    StructTrace trace(rec, "clist");
    CircularLinkedList list(trace);
    for (const ParsedOp& op : ops) {
        trace.setOp(op.text);
        if (op.command == "insert_head") {
            bool ok = list.insertHead(static_cast<int>(op.args[0]));
            trace.log(ok ? "inserted at head" : "rejected", ok, op.args[0]);
        } else if (op.command == "insert_tail") {
            bool ok = list.insertTail(static_cast<int>(op.args[0]));
            trace.log(ok ? "inserted at tail" : "rejected", ok, op.args[0]);
        } else if (op.command == "delete") {
            bool ok = list.remove(static_cast<int>(op.args[0]));
            trace.log(ok ? "deleted" : "not found", ok, op.args[0]);
        } else if (op.command == "search") {
            int at = list.search(static_cast<int>(op.args[0]));
            trace.log(at >= 0 ? "found" : "not found", at >= 0, at);
        } else {
            list.traverse();
            trace.log("traversed one lap", true, Json::fromVector(list.values()));
        }
    }
    return Json::object({{"items", Json::fromVector(list.values())}, {"size", list.size()}, {"log", trace.takeLog()}});
}
// ==== END circular_linked_list ====

// ------------------------------ grammar / defaults --------------------------

std::map<std::string, int> StackAlgorithm::grammar() const {
    return {{"push", 1}, {"pop", 0}, {"peek", 0}, {"size", 0}, {"isempty", 0}};
}
std::map<std::string, int> QueueAlgorithm::grammar() const {
    return {{"enqueue", 1}, {"dequeue", 0}, {"front", 0}, {"size", 0}, {"isempty", 0}};
}
std::map<std::string, int> SinglyLinkedListAlgorithm::grammar() const {
    return {{"insert_head", 1}, {"insert_tail", 1}, {"insert_at", 2}, {"delete", 1}, {"search", 1}, {"traverse", 0}};
}
std::map<std::string, int> DoublyLinkedListAlgorithm::grammar() const {
    return {{"insert_head", 1}, {"insert_tail", 1}, {"insert_at", 2}, {"delete", 1},
            {"search", 1},      {"traverse", 0},    {"traverse_back", 0}};
}
std::map<std::string, int> CircularLinkedListAlgorithm::grammar() const {
    return {{"insert_head", 1}, {"insert_tail", 1}, {"delete", 1}, {"search", 1}, {"traverse", 0}};
}

namespace {
Json opsOf(std::initializer_list<const char*> list) {
    Json out = Json::array();
    for (const char* op : list) out.push(op);
    return out;
}
}  // namespace

Json StackAlgorithm::defaultInput() const {
    return Json::object({{"ops", opsOf({"push 10", "push 20", "push 30", "peek", "pop", "pop", "push 40", "pop", "pop", "pop"})},
                         {"capacity", 6}});
}
Json QueueAlgorithm::defaultInput() const {
    return Json::object({{"ops", opsOf({"enqueue 5", "enqueue 8", "enqueue 13", "dequeue", "enqueue 21", "enqueue 34",
                                        "dequeue", "front", "enqueue 55", "enqueue 89", "enqueue 99"})},
                         {"capacity", 5}});
}
Json SinglyLinkedListAlgorithm::defaultInput() const {
    return Json::object({{"ops", opsOf({"insert_tail 10", "insert_tail 20", "insert_head 5", "insert_at 2 15", "search 20",
                                        "delete 10", "traverse"})}});
}
Json DoublyLinkedListAlgorithm::defaultInput() const {
    return Json::object({{"ops", opsOf({"insert_tail 10", "insert_tail 20", "insert_head 5", "insert_at 2 15", "delete 10",
                                        "traverse", "traverse_back"})}});
}
Json CircularLinkedListAlgorithm::defaultInput() const {
    return Json::object({{"ops", opsOf({"insert_tail 10", "insert_tail 20", "insert_head 5", "search 20", "delete 5", "traverse"})}});
}

void registerStructureAlgorithms(AlgorithmManager& manager) {
    manager.add(std::make_unique<StackAlgorithm>());
    manager.add(std::make_unique<QueueAlgorithm>());
    manager.add(std::make_unique<SinglyLinkedListAlgorithm>());
    manager.add(std::make_unique<DoublyLinkedListAlgorithm>());
    manager.add(std::make_unique<CircularLinkedListAlgorithm>());
}

}  // namespace bf
