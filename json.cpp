#include "json.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace bf {

namespace {

const Json kNull;
const std::string kEmpty;

class Parser {
public:
    explicit Parser(const std::string& text) : s_(text) {}

    Json parseDocument() {
        skipSpace();
        Json value = parseValue(0);
        skipSpace();
        if (pos_ != s_.size()) fail("Unexpected trailing characters");
        return value;
    }

private:
    [[noreturn]] void fail(const std::string& message) const {
        throw JsonError(message + " at position " + std::to_string(pos_));
    }

    void skipSpace() {
        while (pos_ < s_.size() &&
               (s_[pos_] == ' ' || s_[pos_] == '\n' || s_[pos_] == '\t' || s_[pos_] == '\r'))
            ++pos_;
    }

    char peek() const { return pos_ < s_.size() ? s_[pos_] : '\0'; }

    void expect(char c) {
        if (peek() != c) fail(std::string("Expected '") + c + "'");
        ++pos_;
    }

    bool consumeWord(const char* word) {
        std::size_t len = std::char_traits<char>::length(word);
        if (s_.compare(pos_, len, word) == 0) {
            pos_ += len;
            return true;
        }
        return false;
    }

    Json parseValue(int depth) {
        if (depth > 64) fail("Nesting too deep");
        skipSpace();
        char c = peek();
        if (c == '{') return parseObject(depth);
        if (c == '[') return parseArray(depth);
        if (c == '"') return Json(parseString());
        if (c == '-' || (c >= '0' && c <= '9')) return parseNumber();
        if (consumeWord("true")) return Json(true);
        if (consumeWord("false")) return Json(false);
        if (consumeWord("null")) return Json();
        fail("Unexpected character");
    }

    Json parseObject(int depth) {
        Json obj = Json::object();
        expect('{');
        skipSpace();
        if (peek() == '}') {
            ++pos_;
            return obj;
        }
        while (true) {
            skipSpace();
            if (peek() != '"') fail("Expected string key");
            std::string key = parseString();
            skipSpace();
            expect(':');
            obj[key] = parseValue(depth + 1);
            skipSpace();
            if (peek() == ',') {
                ++pos_;
                continue;
            }
            expect('}');
            return obj;
        }
    }

    Json parseArray(int depth) {
        Json arr = Json::array();
        expect('[');
        skipSpace();
        if (peek() == ']') {
            ++pos_;
            return arr;
        }
        while (true) {
            arr.push(parseValue(depth + 1));
            skipSpace();
            if (peek() == ',') {
                ++pos_;
                continue;
            }
            expect(']');
            return arr;
        }
    }

    static void appendUtf8(std::string& out, unsigned cp) {
        if (cp < 0x80) {
            out += static_cast<char>(cp);
        } else if (cp < 0x800) {
            out += static_cast<char>(0xC0 | (cp >> 6));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        } else if (cp < 0x10000) {
            out += static_cast<char>(0xE0 | (cp >> 12));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        } else {
            out += static_cast<char>(0xF0 | (cp >> 18));
            out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        }
    }

    unsigned parseHex4() {
        if (pos_ + 4 > s_.size()) fail("Truncated unicode escape");
        unsigned value = 0;
        for (int i = 0; i < 4; ++i) {
            char c = s_[pos_++];
            value <<= 4;
            if (c >= '0' && c <= '9') value |= static_cast<unsigned>(c - '0');
            else if (c >= 'a' && c <= 'f') value |= static_cast<unsigned>(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') value |= static_cast<unsigned>(c - 'A' + 10);
            else fail("Invalid unicode escape");
        }
        return value;
    }

    std::string parseString() {
        expect('"');
        std::string out;
        while (true) {
            if (pos_ >= s_.size()) fail("Unterminated string");
            char c = s_[pos_++];
            if (c == '"') return out;
            if (static_cast<unsigned char>(c) < 0x20) fail("Control character in string");
            if (c != '\\') {
                out += c;
                continue;
            }
            if (pos_ >= s_.size()) fail("Bad escape");
            char e = s_[pos_++];
            switch (e) {
                case '"': out += '"'; break;
                case '\\': out += '\\'; break;
                case '/': out += '/'; break;
                case 'b': out += '\b'; break;
                case 'f': out += '\f'; break;
                case 'n': out += '\n'; break;
                case 'r': out += '\r'; break;
                case 't': out += '\t'; break;
                case 'u': {
                    unsigned cp = parseHex4();
                    if (cp >= 0xD800 && cp <= 0xDBFF && s_.compare(pos_, 2, "\\u") == 0) {
                        pos_ += 2;
                        unsigned low = parseHex4();
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
                    }
                    appendUtf8(out, cp);
                    break;
                }
                default: fail("Unknown escape");
            }
        }
    }

    Json parseNumber() {
        std::size_t start = pos_;
        if (peek() == '-') ++pos_;
        if (peek() < '0' || peek() > '9') fail("Invalid number");
        while (peek() >= '0' && peek() <= '9') ++pos_;
        if (peek() == '.') {
            ++pos_;
            if (peek() < '0' || peek() > '9') fail("Invalid number");
            while (peek() >= '0' && peek() <= '9') ++pos_;
        }
        if (peek() == 'e' || peek() == 'E') {
            ++pos_;
            if (peek() == '+' || peek() == '-') ++pos_;
            if (peek() < '0' || peek() > '9') fail("Invalid number");
            while (peek() >= '0' && peek() <= '9') ++pos_;
        }
        return Json(std::strtod(s_.substr(start, pos_ - start).c_str(), nullptr));
    }

    const std::string& s_;
    std::size_t pos_ = 0;
};

void escapeString(const std::string& in, std::string& out) {
    out += '"';
    for (unsigned char c : in) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof buf, "\\u%04x", c);
                    out += buf;
                } else {
                    out += static_cast<char>(c);
                }
        }
    }
    out += '"';
}

}  // namespace

Json Json::array() {
    Json j;
    j.type_ = Type::Array;
    return j;
}

Json Json::array(std::initializer_list<Json> values) {
    Json j = array();
    for (const Json& v : values) j.items_.push_back(v);
    return j;
}

Json Json::object() {
    Json j;
    j.type_ = Type::Object;
    return j;
}

Json Json::object(std::initializer_list<std::pair<std::string, Json>> members) {
    Json j = object();
    for (const auto& m : members) j[m.first] = m.second;
    return j;
}

bool Json::isInteger() const {
    return isNumber() && std::isfinite(num_) && std::floor(num_) == num_ && std::fabs(num_) < 9e15;
}

long long Json::asInt(long long fallback) const {
    return isNumber() && std::isfinite(num_) ? static_cast<long long>(num_) : fallback;
}

const std::string& Json::asString() const { return isString() ? str_ : kEmpty; }

const Json& Json::at(std::size_t index) const {
    return (isArray() && index < items_.size()) ? items_[index] : kNull;
}

bool Json::has(const std::string& key) const {
    if (!isObject()) return false;
    for (const auto& k : keys_)
        if (k == key) return true;
    return false;
}

const Json& Json::operator[](const std::string& key) const {
    if (isObject()) {
        for (std::size_t i = 0; i < keys_.size(); ++i)
            if (keys_[i] == key) return items_[i];
    }
    return kNull;
}

Json& Json::operator[](const std::string& key) {
    if (type_ == Type::Null) type_ = Type::Object;
    if (type_ != Type::Object) throw JsonError("Json value is not an object");
    for (std::size_t i = 0; i < keys_.size(); ++i)
        if (keys_[i] == key) return items_[i];
    keys_.push_back(key);
    items_.emplace_back();
    return items_.back();
}

Json& Json::push(Json value) {
    if (type_ == Type::Null) type_ = Type::Array;
    if (type_ != Type::Array) throw JsonError("Json value is not an array");
    items_.push_back(std::move(value));
    return items_.back();
}

Json Json::parse(const std::string& text) { return Parser(text).parseDocument(); }

std::string Json::dump() const {
    std::string out;
    dumpTo(out);
    return out;
}

void Json::dumpTo(std::string& out) const {
    switch (type_) {
        case Type::Null: out += "null"; break;
        case Type::Boolean: out += bool_ ? "true" : "false"; break;
        case Type::Number: {
            if (!std::isfinite(num_)) {
                out += "null";
            } else if (isInteger()) {
                out += std::to_string(static_cast<long long>(num_));
            } else {
                char buf[40];
                std::snprintf(buf, sizeof buf, "%.12g", num_);
                out += buf;
            }
            break;
        }
        case Type::String: escapeString(str_, out); break;
        case Type::Array: {
            out += '[';
            for (std::size_t i = 0; i < items_.size(); ++i) {
                if (i) out += ',';
                items_[i].dumpTo(out);
            }
            out += ']';
            break;
        }
        case Type::Object: {
            out += '{';
            for (std::size_t i = 0; i < items_.size(); ++i) {
                if (i) out += ',';
                escapeString(keys_[i], out);
                out += ':';
                items_[i].dumpTo(out);
            }
            out += '}';
            break;
        }
    }
}

}  // namespace bf
