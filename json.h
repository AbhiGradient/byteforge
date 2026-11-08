#pragma once
#include <cstddef>
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

namespace bf {

class JsonError : public std::runtime_error {
public:
    explicit JsonError(const std::string& message) : std::runtime_error(message) {}
};

// Small, dependency-free JSON value used for all Node <-> C++ communication.
class Json {
public:
    enum class Type { Null, Boolean, Number, String, Array, Object };

    Json() = default;
    Json(std::nullptr_t) {}
    Json(bool v) : type_(Type::Boolean), bool_(v) {}
    template <typename T,
              typename = typename std::enable_if<std::is_arithmetic<T>::value &&
                                                 !std::is_same<T, bool>::value>::type>
    Json(T v) : type_(Type::Number), num_(static_cast<double>(v)) {}
    Json(const char* s) : type_(Type::String), str_(s) {}
    Json(std::string s) : type_(Type::String), str_(std::move(s)) {}

    static Json array();
    static Json array(std::initializer_list<Json> values);
    static Json object();
    static Json object(std::initializer_list<std::pair<std::string, Json>> members);

    template <typename T>
    static Json fromVector(const std::vector<T>& values) {
        Json out = Json::array();
        for (const T& v : values) out.push(Json(v));
        return out;
    }

    Type type() const { return type_; }
    bool isNull() const { return type_ == Type::Null; }
    bool isBool() const { return type_ == Type::Boolean; }
    bool isNumber() const { return type_ == Type::Number; }
    bool isString() const { return type_ == Type::String; }
    bool isArray() const { return type_ == Type::Array; }
    bool isObject() const { return type_ == Type::Object; }
    bool isInteger() const;

    bool asBool(bool fallback = false) const { return isBool() ? bool_ : fallback; }
    double asNumber(double fallback = 0.0) const { return isNumber() ? num_ : fallback; }
    long long asInt(long long fallback = 0) const;
    const std::string& asString() const;

    std::size_t size() const { return items_.size(); }
    const Json& at(std::size_t index) const;
    const std::vector<Json>& items() const { return items_; }
    const std::vector<std::string>& keys() const { return keys_; }

    bool has(const std::string& key) const;
    const Json& operator[](const std::string& key) const;
    Json& operator[](const std::string& key);
    Json& push(Json value);

    static Json parse(const std::string& text);
    std::string dump() const;

private:
    void dumpTo(std::string& out) const;

    Type type_ = Type::Null;
    bool bool_ = false;
    double num_ = 0.0;
    std::string str_;
    std::vector<Json> items_;        // array elements or object values
    std::vector<std::string> keys_;  // object keys (insertion ordered)
};

}  // namespace bf
