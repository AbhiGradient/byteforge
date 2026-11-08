// BYTEFORGE algorithm engine.
//
// Node.js starts this program once per request, writes one JSON command to
// stdin and reads one JSON document from stdout. Nothing the user types is
// ever compiled or executed: inputs are parsed as data and validated first.
//
// Commands: ping | list | execute | validate | analyze | math
// Flags:    --selftest (correctness suite)   --version

#include <iostream>
#include <iterator>
#include <string>

#include "algorithm.h"
#include "json.h"
#include "mathparser.h"
#include "selftest.h"

namespace {

constexpr std::size_t kMaxRequestBytes = 256 * 1024;
const char* kVersion = "1.0.0";

bf::Json errorReply(const std::string& message) {
    return bf::Json::object({{"ok", false}, {"error", message}});
}

bf::Json handle(const bf::Json& request, const bf::AlgorithmManager& manager) {
    const std::string command = request["cmd"].asString();
    bf::ExecutionEngine engine(manager);

    if (command == "ping") {
        return bf::Json::object({{"ok", true}, {"engine", "BYTEFORGE C++17"}, {"version", kVersion}, {"algorithms", manager.count()}});
    }
    if (command == "list") {
        return bf::Json::object({{"ok", true}, {"algorithms", manager.describeAll()}});
    }
    if (command == "validate" || command == "execute") {
        const std::string id = request["id"].asString();
        const bf::Algorithm* algorithm = manager.find(id);
        if (!algorithm) return errorReply("Unknown algorithm '" + id + "'.");
        const bf::Json& input = request["input"];
        if (!input.isObject()) return errorReply("'input' must be a JSON object.");
        if (command == "validate") {
            bf::ValidationResult v = algorithm->validate(input);
            return v.ok ? bf::Json::object({{"ok", true}}) : errorReply(v.error);
        }
        bf::ExecutionReport report = engine.execute(id, input);
        return report.toJson(*algorithm, input);
    }
    if (command == "analyze") {
        bf::ComplexityAnalyzer analyzer(manager);
        return analyzer.measure(request["id"].asString());
    }
    if (command == "math") {
        bf::ExpressionEvaluator evaluator;
        return evaluator.evaluate(request["expression"].asString()).toJson();
    }
    return errorReply("Unknown command '" + command + "'.");
}

}  // namespace

int main(int argc, char** argv) {
    bf::AlgorithmManager manager;
    bf::registerAllAlgorithms(manager);

    if (argc > 1) {
        std::string flag = argv[1];
        if (flag == "--version") {
            std::cout << "byteforge " << kVersion << "\n";
            return 0;
        }
        if (flag == "--selftest") return bf::runSelfTest(manager, std::cout) == 0 ? 0 : 1;
        std::cerr << "Usage: byteforge [--selftest | --version]  (JSON command on stdin otherwise)\n";
        return 2;
    }

    std::string body((std::istreambuf_iterator<char>(std::cin)), std::istreambuf_iterator<char>());
    if (body.size() > kMaxRequestBytes) {
        std::cout << errorReply("Request is too large.").dump() << "\n";
        return 0;
    }
    try {
        bf::Json request = bf::Json::parse(body);
        if (!request.isObject()) {
            std::cout << errorReply("The request must be a JSON object.").dump() << "\n";
            return 0;
        }
        std::cout << handle(request, manager).dump() << "\n";
    } catch (const bf::JsonError& e) {
        std::cout << errorReply(std::string("Malformed JSON: ") + e.what()).dump() << "\n";
    } catch (const std::exception& e) {
        std::cout << errorReply(std::string("Internal error: ") + e.what()).dump() << "\n";
    }
    return 0;
}
