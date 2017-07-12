var Dashboard = function (options) {
    var that = this;

    var defaults = {
        router: {
            utility: "/Utility/",
            session: "/Session/",
            services: "/Services/",
            login: "/",
            logout: "/logout",
            servicesList: {
                dashboard: "ReaderDashboard.asmx",
                clientDashboard: "API2.asmx",
                publicAPI: "PublicAPI.asmx"
            }
        },
        user: {
            token: null,
            uid: null,
            type: "reader", // reader || client
            userInfo: {},
            isWriter: false,
            isReader: false,
            isPureReader: false,
            mayUpgrade: true,
            accType: "" // Basic || CorpAdmin || CorpSubuser || Pro 
        },
        currentState: {
            gettingToken: false,
            filter: []
        },
        current: {
            id: "",
            sorter: null,
            Books: {
                toRender: [],
                renderedLength: 0,
                sorter: null,
                filter: []
            },
            Series: {
                toRender: [],
                renderedLength: 0,
                sorter: null,
                filter: []
            }
        },
        cachedData: {},
        variables: {
            loadStep: 20,
            sharingTypes: ["Public", "Private", "Password"]
        },
        text: {
            emptyPublications: "",
            emptyCollections: ""
        },
        onGetToken: [],
        stack: [],
        xhrStack: [],
        cache: {},
        requestsCount: 0,
        requestsCache: {},
        onEmptySession: null,
        isLocal: false
    };

    $.extend(true, this, {}, defaults, options);

    $$(function() {
        setTimeout(function() {
            that.init();
        },500);
    });
};

Dashboard.prototype.init = function () {
    var self = this;
    
    // Check for local
    if (location.host == "cld.local") {
        self.isLocal = true;
    }

    // Check for "IsClient" (not reader)
    if (this.user.type == "client") {
        this.user.uid = true;
    }

    // Apply saved requests cache
    if (sessionStorage.getItem('requestsCache')) {
        try {
            self.requestsCache = JSON.parse(sessionStorage.getItem('requestsCache'));
        } catch(e) {
            throw new Error('Error while parsing requests cache');
        }
    }
    
    // Get access token
    this.getToken(true);
};

Dashboard.prototype.getToken = function (full, options) {
    var self = this;

    full = full || false;
    options = options || {};

    // Stop if getting token in process
    if (this.currentState.gettingToken) {
        return false;
    }
    this.currentState.gettingToken = true;

    // Show preloader while getting token
    self.preloader('show');

    function onSuccess(data) {
        self.currentState.gettingToken = false; // token got
        self.user.token = data.Token || null; // save token
        self.user.uid = data.Uid ? data.Uid : self.user.type == "client" ? true : null; // save Uid if user is reader

        if ("client" != self.user.type) {
            self.user.isReader = true;
        } else {
            self.user.isWriter = true;
        }

        self.setAccountInfo(data);

        self.checkAccountState();

        if (!Dashboard.keepPreloader) {
            setTimeout(function () {
                self.preloader('hide');
            }, 700);
        }

        setTimeout(function() {self._onTokenGet();},100);

        if (self.stack.length) {
            setTimeout(function () {
                var stackSize = self.stack.length;

                if (stackSize) {
                    for (var i = 0; i < stackSize; i++) {
                        var func = self.stack[i];

                        if (func.args[0] && func.args[0].data && func.args[0].data.request) {
                            $.extend(func.args[0].data.request, {
                                SessionToken: self.user.token,
                                Uid: self.user.uid
                            });
                        }

                        func.fn.apply(self, func.args);
                    }
                    self.stack = [];
                }
            }, 300);
        }
        
        self.addFunctions();
        
        self.localStorage.init();
    }

    if (sessionStorage.getItem('sessionUserInfo') && !full) {
        onSuccess(JSON.parse(sessionStorage.getItem('sessionUserInfo')));
    } else {
        options.accessToken = Login.accessToken || null;

        this.callWebService({
            forced: full,
            url: this.router.frontendApi + '/GetUserInfo',
            data: options,
            useProxy: false,
            onSuccess: function (data) {
                sessionStorage.setItem('sessionUserInfo', JSON.stringify(data));

                onSuccess(data);
            },
            onError: function () {
                self.requestsCount++;
                self.currentState.gettingToken = false;

                if (typeof self.onEmptySession == "function" && self.requestsCount < 3) {
                    self.onEmptySession();
                } else {
                    window.location.href = self.router.login + '#reason=no-license';
                }
            }
        });
    }
};

Dashboard.prototype._onTokenGet = function () {
    var self = this;

    if (self.onGetToken.length) {
        $.each(self.onGetToken, function (i, fn) {
            
            if ("function" === typeof fn) {
                fn();
            }
        });

        self.onGetToken = [];
    }
};

Dashboard.prototype.getCurrentUserInfo = function (data,updateInfo) {
    data = data.d || data;
    data = data || {};

    updateInfo = updateInfo || false;

    var userInfo = {};
    
    if (data.Reader) {
        userInfo = data.Reader;

        if (data.Superuser && data.Superuser.IsSelf) {
            userInfo = data.Superuser;
        } else if (data.Subusers) {
            $.each(data.Subusers, function (i, user) {
                if (user.IsSelf) {
                    userInfo = user;
                }
            });
        }
    }
    
    if (updateInfo) {
        this.user.userInfo = userInfo;
    }

    return userInfo;
};

Dashboard.prototype.setAccountInfo = function(data) {
    var self = this;

    self.user.AccountInfo = data;
    
    if (data.Superuser) {
        self.user.isWriter = false;
        try {
            $.each(self.user.AccountInfo.Features, function (key, val) {
                if (val) {
                    self.user.isWriter = true;
                }
            });
        } catch (e) { }
    } else {
        self.user.isReader = true;
        self.user.isWriter = false;
        self.user.isPureReader = true;
    }

    if (data.Reader) {
        self.user.isReader = true;
        self.user.userInfo = data.Reader;
        
        if (data.Superuser && data.Superuser.IsSelf) {
            self.user.userInfo.LinkTemplates = data.Superuser.LinkTemplates;
        } else if (data.Subusers) {
            $.each(data.Subusers, function(i, user) {
                if (user.IsSelf) {
                    self.user.userInfo.LinkTemplates = user.LinkTemplates;
                }
            });
        } else {
            self.user.userInfo.LinkTemplates = [];
        }
    }

    if (self.user.type == "client") {
        if (data.Superuser && data.Superuser.IsSelf) {
            self.user.userInfo = data.Superuser;
        } else {
            if (data.Subusers) {
                $.each(data.Subusers, function (i, user) {
                    if (user.IsSelf) {
                        self.user.userInfo = user;
                    }
                });
            }
        }
    }
    
    if (self.user.isReader && !self.user.isWriter) {
        self.user.isPureReader = true;
    }


    self.user.editionName = "Corporate";
    if (!data.Features || !data.Features.FacebookApp) {
        self.user.accType = "Basic";
        self.user.editionName = "Basic";
    } else if (!data.Features.Teamwork) {
        self.user.accType = "Pro";
        self.user.editionName = "Professional";
    } else if (data.Superuser.IsSelf) {
        self.user.accType = "CorpAdmin";
    } else {
        self.user.accType = "CorpSubuser";
    }
    
    self.user.usersList = [];
    
    if (!self.user.isPureReader) {
        var publicHomePage = "#";
        if (self.isLocal) {
            publicHomePage = "http://cld.local/users/" + self.user.AccountInfo.Superuser.UrlName;
        } else {
            if ("Basic" == self.user.accType) {
                publicHomePage = "http://" + location.host + "/users/" + self.user.AccountInfo.Superuser.UrlName;
            } else {
                publicHomePage = "http://" + self.user.AccountInfo.Superuser.UrlName + "." + location.host;
            }
        }

        self.user.userInfo["PublicHomePage"] = self.user.userInfo["PublicHomePage"] || publicHomePage;

        if (self.user.AccountInfo["Superuser"]) {
            self.user.usersList.push(self.user.AccountInfo["Superuser"]);
        }

        $.each(self.user.AccountInfo["Subusers"], function (i, user) {
            self.user.usersList.push(user);
        });
    }
    
    if (!dashboard.user.isPureReader && (self.user.accType == "CorpSubuser" || self.user.AccountInfo.QuotaInfo.QuotaName == "Publ/30G" || self.user.AccountInfo.LicenseSource == "Reseller")) {
        self.user.mayUpgrade = false;
    }
};

Dashboard.prototype.callWebService = function (options) {
    var self = this;

    var defaults = {
        url: "",
        data: {
            request: {
                SessionToken: this.user.token,
                Uid: this.user.uid
            }
        },
        onSuccess: function() {},
        onError: function () {},
        forced: true,
        useProxy: true
    };

    if (typeof options == "string") {
        options = { url: options };
    }

    options = $.extend(true, {}, defaults, options);
    
    if ((!this.user.token || !this.user.uid) && !options.forced) {
        this.stack.push({
            fn: arguments.callee,
            args: arguments
        });
        this.getToken();
        return;
    }
    
    if (!$.browser.ie && parseFloat($.browser.version) < 10) {
        options.url = '/AjaxProxy?target=' + encodeURIComponent(options.url);
    }

    var dataToSend = JSON.stringify(options.data);

    function onSuccess(data) {
        data = data.d || data;
        if (data && data.Success) {
            options.onSuccess(data);
        } else {
            options.onError(data);
        }
    };

    var hash = Base64.encode(options.url + dataToSend);

    if (self.requestsCache[hash] && !options.forced) {
        onSuccess(self.requestsCache[hash]);
    } else {
        var xhr = $.ajax({
            url: options.url,
            type: "POST",
            cache: false,
            contentType: "application/json; charset=utf-8",
            data: dataToSend,
            dataType: "json",
            success: function (data) {
                data = data.d || data;
                self.requestsCache[hash] = data;
                try {
                    //sessionStorage.setItem('requestsCache', JSON.stringify(self.requestsCache));
                    sessionStorage.removeItem('requestsCache');
                } catch(e) {
                    throw new Error('Error while stringify request cache');
                }
                onSuccess(data);
            },
            error: function (data) {
                data = data.d || data;
                options.onError(data);
            }
        });

        self.xhrStack.push(xhr);
    }
};

Dashboard.prototype.abortAllAjax = function() {
    var self = this;

    $.each(self.xhrStack,function(i, xhr) {
        xhr.abort();
    });
};

Dashboard.prototype.rawHtml = function (template, data, dataTransition) {
    if (!window.Templates || !window.Templates[template]) return;
    dataTransition = dataTransition || null;

    template = window.Templates.get(template);

    if (data[template.obj] == null) return "";

    if (!dataTransition) {
        data = {
            items: data[template.obj]
        };
    } else {
        var data_ = {
            items: []
        };

        $.each(data[template.obj],function(i, item) {
            data_.items.push(dataTransition(item));
        });

        data = data_;
    }

    return Mustache.to_html(template.tpl,data);
};

Dashboard.prototype.loadItems = function (options) {
    var self = this;
    var defaults = {
        url: null,
        title: null,
        data: {},
        block: $('<div/>'),
        append: false,
        template: "",
        justData: false,
        forced: false,
        useProxy: false,
        dataTransition: null,
        beforeLoading: function (){},
        afterLoading: function (){}
    };

    options = $.extend(true, {}, defaults, options);
    
    if (options.url != null) {
        if (!Templates[options.template] && !options.justData) {
            return false;
        }

        options.beforeLoading();
        this.callWebService({
            url: options.url,
            data: options.data,
            forced: options.forced,
            useProxy: options.useProxy,
            onSuccess: function (data) {
                if (!options.append) {
                    options.block.children().remove();
                }
                
                if (options.title) {
                    var obj = {};

                    obj[options.title] = self.updateStorage(options.title, data[options.title]||[]);

                    data = $.extend(true,{},data,obj);
                }

                var resultHtml = self.rawHtml(options.template, data, options.dataTransition);
                options.block.append(resultHtml);

                options.afterLoading(data, resultHtml);
            },
            onError: function() {}
        });
    } else {
        if (!options.append) {
            options.block.children().remove();
        }
        var $result = $(Mustache.to_html(options.template, options.data)).appendTo(options.block);

        options.afterLoading();

        return $result;
    }
};

Dashboard.prototype.getUserById = function (id) {
    var self = this;

    var user = {
        DisplayName: "unknown user",
        Email: "email is empty",
        Id: null,
        IsAdministrator: false,
        IsSelf: false,
        LastActivity: null,
        Name: "unknown user"
    };

    $.each(self.user.usersList, function(i, u) {
        if (u.Id && u.Id == id) {
            user = u;
        }
    });

    return user;
};

Dashboard.prototype.extend = function (prop, val) {
    var self = this;

    this[prop] = this[prop] || {};
    this[prop][val[0]] = function () {
        return val[1].apply(self, arguments.callee.arguments);
    };
};

Dashboard.prototype.addFunctions = function () {
    var self = this;
    
    var id = 'User' + self.user.AccountInfo.Uid;
    
    self.extend('localStorage', ['init', function () {
        if (!window.localStorage.getItem(id)) {
            window.localStorage.setItem(id, "{}");
        }
    }]);
    
    self.extend('localStorage', ['clear', function () {
        return window.localStorage.removeItem(id);
    }]);

    self.extend('localStorage',['getSize', function() {
        return Math.ceil(localStorage[id].length / 1024);
    }]);
    
    self.extend('localStorage', ['setItem', function (title,data) {
        var currentLs = {};

        try {
            currentLs = JSON.parse(window.localStorage.getItem(id)) || {};
        } catch (e) { }

        currentLs[title] = data;

        window.localStorage.setItem(id, JSON.stringify(currentLs));
    }]);
    
    self.extend('localStorage', ['getItem', function (title, json) {
        json = json || false;

        var currentLs = {};

        try {
            currentLs = JSON.parse(window.localStorage.getItem(id)) || {};
        } catch (e) { }

        var res = null;
        
        if (currentLs[title]) {
            try {
                res = currentLs[title];
            } catch (e) {}
        }

        return json ? JSON.parse(res) : res;
    }]);
    
    self.extend('localStorage', ['removeItem', function (title) {
        var currentLs = {};

        try {
            currentLs = JSON.parse(window.localStorage.getItem(id)) || {};
        } catch (e) { }

        if (currentLs[title]) {
            try {
                delete currentLs[title];
            } catch (e) { }
        }
        
        window.localStorage.setItem(id, JSON.stringify(currentLs));
    }]);
};

Dashboard.prototype.updateStorage = function (title, data) {
    var self = this;

    if (self.localStorage.getItem(title) == null) {
        self.localStorage.setItem(title, JSON.stringify([]));
    }

    {
        function extendArrays(arr1, arr2) {
            if (arr1.length >= arr2.length) {
                var small = arr2,
                    large = arr1;
            } else {
                small = arr1;
                large = arr2;
            }

            var result = [];

            for (var i = 0; i < large.length; i++) {
                var item = large[i];

                var similiar = _.where(small, { Id: item.Id });

                if (similiar.length) {
                    result.push(similiar[0]);
                } else {
                    result.push(item);
                }
            }

            return result;
        }

        try {
            var currentValStr = self.localStorage.getItem(title),
                currentVal = currentValStr ? JSON.parse(currentValStr) : [];
        } catch (e) {
            currentValStr = "";
            currentVal = [];
        }

        var newVal = extendArrays(currentVal, data);
        newVal = JSON.stringify(newVal);

        var lsIsAvailable = self.localStorageIsAvailable();

        if (lsIsAvailable && (newVal.length - currentValStr.length) / 1024 < lsIsAvailable) {
            self.localStorage.setItem(title, newVal);
        } else {
            self.localStorage.removeItem(title);
        }
        
        if (!self.current[title]) {
            self.current[title] = {
                toRender: [],
                renderedLength: 0,
                sorter: null,
                filter: []
            };
        }
        
        self.current[title].toRender = JSON.parse(newVal) || [];
        var res = self.current[title].toRender;
    }

    res = res || [];
    try {
        res = res || self.localStorage.getItem(title, true) || [];
    } catch (e) { }
    
    self.current[title].toRender = res;

    return res;
};

Dashboard.prototype.getLinkTemplate = function (linkType) {
    var self = this;
    
    var linkTypes = {
        "publicationUrl": 17,
        "collectionUrl": 65,
        "publicationFriendlyUrl": 10,
        "collectionFriendlyUrl": 34,
        "publicationFriendlyUrlSubdomain": 12,
        "collectionFriendlyUrlSubdomain": 36
    };

    linkType = linkTypes[linkType];

    var template = "";

    $.each(self.user.userInfo.LinkTemplates, function (i, item) {
        if (item.LinkParts == linkType) {
            template = item.Template;
        }
    });

    return template;
};


Dashboard.prototype.preloader = function(method, className) {
    method = method || "show";
    className = className || "";

    var $body = $(document.body);

    if (method == "show") {
        $body.addClass('loading ' + className);
    } else {
        setTimeout(function() {
            $body.removeClass('loading');
        },500);
    }
};

Dashboard.prototype.fillMainData = function () {
    var self = this;

    $('.main-data-home-page').show().attr({
        href: self.user.userInfo.PublicHomePage
    });
    
    $('.main-data-home-page-link').show().html(self.user.userInfo.PublicHomePage);

    $('.main-data-home-page-input').val(self.user.userInfo.UrlName);

    try {
        $('.short-library-address').html(self.user.userInfo.PublicHomePage.shorten(25)).attr({
            href: self.user.userInfo.PublicHomePage,
            title: self.user.userInfo.PublicHomePage
        });
    } catch (e) { } 
};

// New experimental methods

// @type can be "Books" or "Series"
Dashboard.prototype.renderItems = function (type, options) {
    var self = this;

    var defaults = {
        before: function() {},
        after: function () {},
        offset: 0,
        count: null,
        container: "",
        template: "",
        removeOldItems: false,
        items: null,
        type: ""
    };

    options = $.extend(defaults, options);

    options.container = typeof options.container == "string" ? $(options.container) : options.container;
    options.template = Templates.get(options.template).tpl;
    options.type = options.type || type;

    options.before.call(self);
    
    if (!self.current[options.type]) {
        self.current[options.type] = {
            toRender: [],
            renderedLength: 0,
            sorter: null,
            filter: []
        };
    }
    
    if (options.items) {
        var items = options.items;
    } else {
        if (self.current[options.type].toRender.length) {
            items = self.current[options.type].toRender;
        } else {
            items = self.localStorage.getItem(options.type);
            if (items) {
                items = JSON.parse(items);
                self.current[options.type].toRender = items || [];
            }
        }
    }
    
    if (options.removeOldItems) {
        options.container.empty();
    }
   
    if (items) {
        var sorter = self.current.sorter;
        // Check for sorter
        if (sorter) {
            items = self.sorter(options.type, sorter.sorter, sorter.order);
            self.current[options.type].toRender = items || [];

            options.offset = 0;
            options.removeOldItems = true;
        }
        
        if (!options.sorting) {
            options.count = options.count + self.current[options.type].renderedLength;
        }

        if (options.count) {
            items = items.slice(options.offset, options.offset + options.count);
        }
        
        // Is it sorting operation?
        if (!options.sorting) {
            self.current[options.type].renderedLength += items.length;
        }
        
        var itemsTransitioned = Transitions.all.call(self, type, items);

        var html = Mustache.to_html(options.template, {
            items: itemsTransitioned
        });
        
        options.container.show().append(html);
    }

    options.after.call(self);

    return self.current[options.type].renderedLength < self.current[options.type].toRender.length ? true : false;
};

Dashboard.prototype.more = function (type,options) {
    var self = this;

    var typeOfRender = options.type || type;

    options = $.extend(options, {
        offset: self.current[typeOfRender].renderedLength
    });

    return self.renderItems(type,options);
};

Dashboard.prototype.sorter = function (type, sorter, order) {
    return Sorters.all.call(this,type,sorter,order);
};

Dashboard.prototype.filter = function (filter, vals, type) {
    type = type || "Books";

    return Filters[type][filter].call(this, vals);
};

Dashboard.prototype.changeFilter = function (type, filter) {
    var self = this;
    
    if (!self.current[type]) {
        self.current[type] = {
            toRender: [],
            renderedLength: 0,
            sorter: null,
            filter: []
        };
    }

    self.current[type].renderedLength = 0;
    self.current[type.indexOf('Series') == 0 ? 'Series' : 'Books'].filter = filter;
};

Dashboard.prototype.changeSorter = function (sorter) {
    var self = this;

    sorter = sorter || {};

    var type = "Books"; // hardcode

    self.current[type].sorter = sorter;
    self.current.sorter = sorter;
};

Dashboard.prototype.update = function (type, options) {
    var self = this;

    options = options || {};

    var defaults = {
        success: function(){},
        error: function () {},
        type: "",
        request: {
            PartsToReturn: 17,
            Scope: "CurrentUser",
            Count: self.isLocal ? self.variables.loadStep : null,
            ModifiedSince: null
        }
    };

    var cachedItems = [];
    try {
        cachedItems = JSON.parse(self.localStorage.getItem(options.type || type));
    } catch(e) {

    }
    

    // Caching temporary switched off
    //defaults.request.ModifiedSince = cachedItems && cachedItems.length ? (self.localStorage.getItem(type + 'CachingDate') || null) : null;

    options = $.extend(true,defaults,options);
    
    var publicationsUrl = self.router.services + self.router.servicesList[(self.user.type == "client" ? "clientDashboard" : "dashboard")] + "/GetBooks";
    
    var collectionsUrl = self.router.services + self.router.servicesList.dashboard + '/GetSeries';
    if (self.user.type == "client") {
        collectionsUrl = self.router.services + self.router.servicesList.clientDashboard + '/GetSeries';
    }

    var url = type == "Books" ? publicationsUrl : collectionsUrl;
    
    self.callWebService({
        url: url,
        data: {
            request: options.request
        },
        forced: true,
        useProxy: false,
        onSuccess: function (data) {
            if (data[type] && data[type].length) {
                self.localStorage.setItem(type + 'CachingDate', dateFormat((new Date), "mm/dd/yyyy HH:MM:ss"));
            }

            self.localStorage.setItem(options.type || type, []);
            self.updateStorage(options.type || type, data[type] || []);
            options.success.call(self,data);
        },
        onError: function (data) {
            options.error.call(self,data);
        }
    });
};

Dashboard.prototype.uniqObjArrays = function (small, large) {
    var res = [];

    var concated = small.concat(large);

    for (var i = 0; i < concated.length; i++) {
        var item = concated[i],
            equal = false;

        for (var j = 0; j < res.length; j++) {
            if (_.isEqual(res[j], item)) {
                equal = true;
            }
        }

        if (!equal) {
            res.push(item);
        }
    }

    return res;
};

Dashboard.prototype.localStorageIsAvailable = function () {
    var result = false;

    var maxSize = 2000;
    
    try {
        if (window.localStorage) {
            var total = 0;

            for (var key in localStorage) {
                if (!localStorage.hasOwnProperty(key))
                    continue;
                total += localStorage[key].length;
            }

            total = Math.ceil(total / 1024);

            if (total < maxSize) {
                result = maxSize - total; // KBs left
            }
        }
    } catch(e) {
        // ... ignore
    }

    return result;
};

Dashboard.prototype.updateItem = function (type, id, data) {
    var self = this;

    var items = self.current[type].toRender,
        itemsLength = items.length,
        currentItemPos = NaN,
        updatedItem = {};
    
    for (var i = 0; i < itemsLength; i++) {
        var item = items[i];
        
        if (item.Id == id) {
            currentItemPos = i;
            updatedItem = $.extend(item,data);
        }
    }
    
    if (!isNaN(currentItemPos)) {
        items.splice(currentItemPos,1,updatedItem);
    }
    
    return updatedItem;
};

Dashboard.prototype.getPublicationById = function (id) {
    return _.findWhere(dashboard.current[dashboard.current.id || "Books"].toRender, { Id: id });
};

Dashboard.prototype.getCollectionById = function (id) {
    return _.findWhere(dashboard.current["Series"].toRender, { Id: id });
};

Dashboard.prototype.removeItem = function (type, id) {
    var self = this;

    var items = self.current[type].toRender,
        itemsLength = items.length,
        itemPos = NaN;
    
    for (var i = 0; i < itemsLength; i++) {
        var item = items[i];

        if (item.Id == id) {
            itemPos = i;
        }
    }
    
    if (!isNaN(itemPos)) {
        items.splice(itemPos, 1);
        try {
            self.localStorage.setItem(type, JSON.stringify(items));
        } catch(e) {

        }
    }
};

Dashboard.prototype.checkAccountState = function() {
    var self = this;

    if (self.user.isPureReader) return;

    var accExpired = false,
        loc = "#";

    var expirationDate = null;
    try {
        expirationDate = self.user.AccountInfo.QuotaInfo.Expiration.replace(/[^0-9-]/g, '');
        expirationDate = new Date(parseInt(expirationDate));
    } catch (e) { }

    if (expirationDate && expirationDate < (new Date)) {
        accExpired = true;
        loc = "/my/account-expired";
    } else {
        loc = "/my";
    }

    if (accExpired && location.pathname != loc) {
        location.href = loc;
    }
}
