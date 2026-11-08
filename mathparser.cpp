#include "mathparser.h"

#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace bf {

namespace {

enum class Kind { Number, Operator, LeftParen, RightParen };

struct Token {
    Kind kind;
    std::string text;  // number text or operator symbol ("u-" and "u+" are unary)
    double number = 0.0;
};

int precedence(const std::string& op) {
    if (op == "+" || op == "-") return 1;
    if (op == "*" || op == "/" || op == "%") return 2;
    if (op == "u-" || op == "u+") return 3;
    if (op == "^") return 4;
    return 0;
}

bool rightAssociative(const std::string& op) { return op == "^" || op == "u-" || op == "u+"; }
bool isUnary(const std::string& op) { return op == "u-" || op == "u+"; }

bool tokenize(const std::string& s, std::vector<Token>& out, std::string& error) {
    std::size_t i = 0;
    while (i < s.size()) {
        unsigned char c = static_cast<unsigned char>(s[i]);
        if (std::isspace(c)) {
            ++i;
            continue;
        }
        if (std::isdigit(c) || c == '.') {
            std::size_t start = i;
            bool dot = false;
            while (i < s.size() && (std::isdigit(static_cast<unsigned char>(s[i])) || s[i] == '.')) {
                if (s[i] == '.') {
                    if (dot) {
                        error = "Number has more than one decimal point.";
                        return false;
                    }
                    dot = true;
                }
                ++i;
            }
            if (i < s.size() && (s[i] == 'e' || s[i] == 'E')) {
                std::size_t save = i++;
                if (i < s.size() && (s[i] == '+' || s[i] == '-')) ++i;
                if (i < s.size() && std::isdigit(static_cast<unsigned char>(s[i]))) {
                    while (i < s.size() && std::isdigit(static_cast<unsigned char>(s[i]))) ++i;
                } else {
                    i = save;
                }
            }
            std::string text = s.substr(start, i - start);
            if (text == ".") {
                error = "A lone '.' is not a number.";
                return false;
            }
            Token t{Kind::Number, text, std::strtod(text.c_str(), nullptr)};
            out.push_back(t);
            continue;
        }
        if (c == '(') {
            out.push_back({Kind::LeftParen, "("});
            ++i;
            continue;
        }
        if (c == ')') {
            out.push_back({Kind::RightParen, ")"});
            ++i;
            continue;
        }
        if (c == '*' && i + 1 < s.size() && s[i + 1] == '*') {
            out.push_back({Kind::Operator, "^"});
            i += 2;
            continue;
        }
        if (c == '+' || c == '-' || c == '*' || c == '/' || c == '%' || c == '^') {
            out.push_back({Kind::Operator, std::string(1, static_cast<char>(c))});
            ++i;
            continue;
        }
        error = std::string("Unsupported character '") + static_cast<char>(c) + "'.";
        return false;
    }
    return true;
}

}  // namespace

std::string ExpressionEvaluator::format(double value) {
    if (value == 0) return "0";
    char buf[64];
    if (std::fabs(value) >= 1e15 || std::fabs(value) < 1e-9) {
        std::snprintf(buf, sizeof buf, "%.10g", value);
    } else {
        std::snprintf(buf, sizeof buf, "%.12g", value);
    }
    return buf;
}

MathResult ExpressionEvaluator::evaluate(const std::string& expression) const {
    MathResult result;
    if (expression.empty() || expression.find_first_not_of(" \t\r\n") == std::string::npos) {
        result.error = "The expression is empty.";
        return result;
    }
    if (expression.size() > kMaxLength) {
        result.error = "The expression is longer than " + std::to_string(kMaxLength) + " characters.";
        return result;
    }

    std::vector<Token> raw;
    if (!tokenize(expression, raw, result.error)) return result;

    // Mark unary operators: a + or - at the start, after an operator or after '('.
    std::vector<Token> tokens;
    for (std::size_t i = 0; i < raw.size(); ++i) {
        Token t = raw[i];
        bool prefixPosition = tokens.empty() || tokens.back().kind == Kind::Operator || tokens.back().kind == Kind::LeftParen;
        if (t.kind == Kind::Operator && prefixPosition) {
            if (t.text == "+" || t.text == "-") t.text = "u" + t.text;
            else {
                result.error = "Operator '" + t.text + "' is missing its left operand.";
                return result;
            }
        }
        tokens.push_back(t);
    }
    for (const Token& t : tokens) result.tokens.push_back(t.text);

    // Shunting Yard: infix -> postfix.
    std::vector<Token> output;
    std::vector<Token> stack;
    for (const Token& t : tokens) {
        if (t.kind == Kind::Number) {
            output.push_back(t);
        } else if (t.kind == Kind::Operator) {
            while (!stack.empty() && stack.back().kind == Kind::Operator && !isUnary(t.text)) {
                int top = precedence(stack.back().text), cur = precedence(t.text);
                if (top > cur || (top == cur && !rightAssociative(t.text))) {
                    output.push_back(stack.back());
                    stack.pop_back();
                } else {
                    break;
                }
            }
            stack.push_back(t);
        } else if (t.kind == Kind::LeftParen) {
            stack.push_back(t);
        } else {
            bool matched = false;
            while (!stack.empty()) {
                if (stack.back().kind == Kind::LeftParen) {
                    matched = true;
                    break;
                }
                output.push_back(stack.back());
                stack.pop_back();
            }
            if (!matched) {
                result.error = "Unbalanced parentheses: a ')' has no matching '('.";
                return result;
            }
            stack.pop_back();
        }
    }
    while (!stack.empty()) {
        if (stack.back().kind == Kind::LeftParen) {
            result.error = "Unbalanced parentheses: a '(' is never closed.";
            return result;
        }
        output.push_back(stack.back());
        stack.pop_back();
    }
    for (const Token& t : output) result.postfix.push_back(t.text);

    // Evaluate the postfix expression.
    std::vector<double> values;
    for (const Token& t : output) {
        if (t.kind == Kind::Number) {
            values.push_back(t.number);
            continue;
        }
        if (isUnary(t.text)) {
            if (values.empty()) {
                result.error = "Malformed expression.";
                return result;
            }
            if (t.text == "u-") values.back() = -values.back();
            continue;
        }
        if (values.size() < 2) {
            result.error = "Malformed expression: operator '" + t.text + "' needs two operands.";
            return result;
        }
        double b = values.back();
        values.pop_back();
        double a = values.back();
        values.pop_back();
        double r = 0;
        if (t.text == "+") r = a + b;
        else if (t.text == "-") r = a - b;
        else if (t.text == "*") r = a * b;
        else if (t.text == "/") {
            if (b == 0) {
                result.error = "Division by zero is undefined.";
                return result;
            }
            r = a / b;
        } else if (t.text == "%") {
            if (b == 0) {
                result.error = "Modulus by zero is undefined.";
                return result;
            }
            r = std::fmod(a, b);
        } else if (t.text == "^") {
            if (a == 0 && b < 0) {
                result.error = "0 raised to a negative power is undefined.";
                return result;
            }
            r = std::pow(a, b);
            if (std::isnan(r)) {
                result.error = "A negative base with a fractional exponent has no real result.";
                return result;
            }
        }
        if (!std::isfinite(r)) {
            result.error = "The result is too large to represent.";
            return result;
        }
        values.push_back(r);
    }
    if (values.size() != 1) {
        result.error = "Malformed expression: missing operator between values.";
        return result;
    }
    result.ok = true;
    result.value = values.front();
    result.formatted = format(result.value);
    return result;
}

Json MathResult::toJson() const {
    Json out = Json::object();
    out["ok"] = ok;
    if (!ok) {
        out["error"] = error;
        return out;
    }
    out["value"] = value;
    out["formatted"] = formatted;
    out["tokens"] = Json::fromVector(tokens);
    out["postfix"] = Json::fromVector(postfix);
    return out;
}

}  // namespace bf
