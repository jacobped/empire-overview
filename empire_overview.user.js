// ==UserScript==
// @name                 Empire Overview
// @name:en              Empire Overview
// @name:el              Empire Overview
// @author               germano / 1.17 to 1.18 by Ariston /up 1.18 germano by mrFiX+(Thanx my friend) /up 1.9xx, 1.20xx /up by jacobped
// @description          Script for Ikariam 8.x.x, Overview tables for resources, buildings and military inspired by Ikariam Empire Board
// @description:en       Script for Ikariam 8.x.x, Overview tables for resources, buildings and military inspired by Ikariam Empire Board
// @description:el       Script for Ikariam 8.x.x, Overview tables for resources, buildings and military inspired by Ikariam Empire Board
// @icon                 https://www.google.com/s2/favicons?domain=ikariam.com
// @namespace            Beta
// @grant                unsafeWindow
// @grant                GM_getValue
// @grant                GM_setValue
// @grant                GM_deleteValue
// @grant                GM_addStyle
// @grant                GM_registerMenuCommand
// @grant                GM_xmlhttpRequest
// @grant                GM_openInTab
// @grant                GM_log
// @grant                GM_getResourceText
// @grant                GM_getResourceURL
//
// @exclude              http://board.*.ikariam.gameforge.com*
// @exclude              http://*.ikariam.gameforge.*/board
// @include              /https?:\/\/s[0-9]*-[a-z]{2}\.ikariam\.gameforge\.com\/.*/
//
// @require              https://ajax.googleapis.com/ajax/libs/jquery/1.11.1/jquery.min.js
// @require              https://ajax.googleapis.com/ajax/libs/jqueryui/1.9.2/jquery-ui.min.js
// 
// Special resource modules
// @resource             programDataScript https://github.com/jacobped/empire-overview/raw/f0d16da04a858079ddc08d0b966ebf98a853c1d4/data/programData.js
// @resource             cssScript https://github.com/jacobped/empire-overview/raw/f0d16da04a858079ddc08d0b966ebf98a853c1d4/data/css.js
//
// @version              1.2008
//
// @license              GPL version 3 or any later version; http://www.gnu.org/copyleft/gpl.html
// ==/UserScript==

/***********************************************************************************************************************
 * Includes
 ********************************************************************************************************************* */

(function ($) {
  var jQuery = $;
  var isChrome;
  if (window.navigator.vendor.match(/Google/)) {
    isChrome = true;
  } else {
    isChrome = false;
  }

  // IMPORTANT: do NOT call jQuery.noConflict(true) here — that removes/replaces the page's jQuery
  // and breaks game scripts (e.g. $.isValue). Use the local jQuery instance passed into the IIFE
  // and make sure we don't overwrite the page's unsafeWindow.jQuery if it already exists.
  if (typeof unsafeWindow.jQuery === 'undefined') {
    // if the page doesn't yet expose jQuery, make ours available so page code (and other libs)
    // that expect jQuery on window will not fail.
    unsafeWindow.jQuery = jQuery;
  }
  if (typeof unsafeWindow.$ === 'undefined') {
    unsafeWindow.$ = jQuery;
  }

  $.extend({
    exclusive: function (arr) {
      return $.grep(arr, function (v, k) {
        return $.inArray(v, arr) === k;
      });
    },

    mergeValues: function (a, b, c) {
      var length = arguments.length;
      if (length == 1 || typeof arguments[0] !== "object" || typeof arguments[1] !== "object") {
        return arguments[0];
      }
      var args = jQuery.makeArray(arguments);
      var i = 1;
      var target = args[0];
      for (; i < length; i++) {
        var copy = args[i];
        for (var name in copy) {
          if (!target.hasOwnProperty(name)) {
            target[name] = copy[name];
            continue;
          }
          if (typeof target[name] == "object" && typeof copy[name] == "object") {
            target[name] = jQuery.mergeValues(target[name], copy[name]);
          } else if (copy.hasOwnProperty(name) && copy[name] !== undefined) {
            target[name] = copy[name];
          }
        }
      }
      return target;
    },
    decodeUrlParam: function (string) {
      var str = string.split('?').pop().split('&');
      var obj = {};
      for (var i = 0; i < str.length; i++) {
        var param = str[i].split('=');
        if (param.length !== 2) {
          continue;
        }
        obj[param[0]] = decodeURIComponent(param[1].replace(/\+/g, " "));
      }
      return obj;
    }
  });

  var events = (function () {
    var _events = {};
    var retEvents = function (id) {
      var callbacks, topic = id && _events[id];
      if (!topic) {
        callbacks = $.Callbacks("");
        topic = {
          pub: callbacks.fire,
          sub: callbacks.add,
          unsub: callbacks.remove
        };
        if (id) {
          _events[id] = topic;
        }
      }
      return topic;
    };

    retEvents.scheduleAction = function (callback, time) {
      return clearTimeout.bind(undefined, setTimeout(callback, time || 0));
    };

    retEvents.scheduleActionAtTime = function (callback, time) {
      return retEvents.scheduleAction(callback, (time - $.now() > 0 ? time - $.now() : 0));
    };

    retEvents.scheduleActionAtInterval = function (callback, time) {
      return clearInterval.bind(undefined, setInterval(callback, time));
    };
    return retEvents;
  })();

  /***********************************************************************************************************************
   * Globals
   **********************************************************************************************************************/
  var debug = false;
  var log = false;
  var timing = false;
  if (!unsafeWindow) unsafeWindow = window;

  // Simplified: load the model directly from unsafeWindow. Disable the external wait module/polling.
  var __cachedModel = null;

  // Always read the live model from unsafeWindow synchronously.
  function getCachedModel() {
    try {
      __cachedModel = (unsafeWindow && unsafeWindow.ikariam && unsafeWindow.ikariam.model) || null;
    } catch (e) {
      __cachedModel = null;
    }
    return __cachedModel;
  }

  // whenModelReady now simply resolves immediately with the current model (no polling).
  function whenModelReady(cb) {
    var p = Promise.resolve(getCachedModel());
    return typeof cb === 'function' ? p.then(cb) : p;
  }

  // Generic GM helpers shared by all resource modules
  const GM_MODULE_HELPERS = {
    addStyle: (...args) => GM_addStyle(...args),
    getValue: (...args) => GM_getValue(...args),
    setValue: (...args) => GM_setValue(...args),
    deleteValue: (...args) => GM_deleteValue(...args),
    xmlHttpRequest: (...args) => GM_xmlhttpRequest(...args),
    openInTab: (...args) => GM_openInTab(...args),
    log: (...args) => GM_log(...args)
  };

  /**
   * Load an ES module from a user-script @resource entry and initialize it.
   * The function itself is not declared async but returns a Promise so callers
   * can chain .then/.catch. It revokes the blob URL and calls init/default
   * if present, passing GM_MODULE_HELPERS.
   *
   * Usage: loadResourceModule('cssScript').then(mod => { ... })
   */
  async function loadResourceModule(resourceName) {
    try {
      let text = null;
      if (typeof GM_getResourceText === 'function') {
        text = GM_getResourceText(resourceName);
      } else if (typeof GM_getResourceURL === 'function') {
        // GM_getResourceURL may return a blob URL; fetch it to get the text.
        const url = GM_getResourceURL(resourceName);
        const resp = await fetch(url);
        text = await resp.text();
      } else {
        return Promise.reject(new Error('No method available to load resource: ' + resourceName));
      }

      const blob = new Blob([text], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      try {
        const mod = await import(url);
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        if (mod && typeof mod.init === 'function') {
          try { mod.init(GM_MODULE_HELPERS); } catch (e) { console.warn('module.init failed', e); }
        } else if (mod && typeof mod.default === 'function') {
          try { mod.default(GM_MODULE_HELPERS); } catch (e) { console.warn('module.default failed', e); }
        }
        return mod;
      } catch (err) {
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        throw err;
      }
    } catch (e) {
      return Promise.reject(e);
    }
  }

  /***********************************************************************************************************************
   * Inject button into page before the page renders the YUI menu or it will not be animated (less work)
   **********************************************************************************************************************/
  $('.menu_slots > .expandable:last').after('<li class="expandable slot99 empire_Menu" onclick=""><div class="empire_Menu image" style="background-image: url(/cdn/all/both/minimized/weltinfo.png); background-position: 0px 0px; background-size:33px auto"></div></div><div class="name"><span class="namebox">Empire Overview</span></div></li>');

  /***********************************************************************************************************************
   * Utility Functions
   **********************************************************************************************************************/
  var Utils = {
    wrapInClosure: function (obj) {
      return (function (x) {
        return function () {
          return x;
        };
      })(obj);
    },
    existsIn: function (input, test) {
      var ret;
      try {
        ret = input.indexOf(test) !== -1;
      } catch (e) {
        return false;
      }
      return ret;
    },
    estimateTravelTime: function (city1, city2) {
      var time;
      if (!city1 || !city2) return 0;
      if (city1[0] == city2[0] && city1[1] == city2[1]) {
        time = 1200 / 60 * 0.5;
      } else {
        time = 1200 / 60 * (Math.sqrt(Math.pow((city2[0] - city1[0]), 2) + Math.pow((city2[1] - city1[1]), 2)));
      }
      return Math.floor(time * 60 * 1000);
    },
    addStyleSheet: function (style) {
      var getHead = document.getElementsByTagName('head')[0];
      var cssNode = window.document.createElement('style');
      var elementStyle = getHead.appendChild(cssNode);
      elementStyle.innerHTML = style;
      return elementStyle;
    },
    escapeRegExp: function (str) {
      return str.replace(/[\[\]\/\{\}\(\)\-\?\$\*\+\.\\\^\|]/g, "\\$&");
    },
    format: function (inputString, replacements) {
      var str = '' + inputString;
      var keys = Object.keys(replacements);
      var i = keys.length;
      while (i--) {
        str = str.replace(new RegExp(this.escapeRegExp('{' + keys[i] + '}'), 'g'), replacements[keys[i]]);
      }
      return str;
    },
    cacheFunction: function (toExecute, expiry) {
      expiry = expiry || 1000;
      var cachedTime = $.now;
      var cachedResult;
      cachedResult = undefined;
      return function () {
        if (cachedTime < $.now() - expiry || cachedResult === undefined) {
          cachedResult = toExecute();
          cachedTime = $.now();
        }
        return cachedResult;
      };
    },
    getClone: function ($node) {
      if ($node.hasClass('ui-sortable-helper') || $node.parent().find('.ui-sortable-helper').length) {
        return $node;
      }
      return $($node.get(0).cloneNode(true));
    },
    setClone: function ($node, $clone) {
      if ($node.hasClass('ui-sortable-helper') || $node.parent().find('.ui-sortable-helper').length) {
        return $node;
      }
      $node.get(0).parentNode.replaceChild($clone.get(0), $node.get(0));
      return $node;
    },
    replaceNode: function (node, html) {
      var t = node.cloneNode(false);
      t.innerHTML = html;
      node.parentNode.replaceChild(t, node);
      return t;
    },
    FormatTimeLengthToStr: function (timeString, precision, spacer) {
      var lang = database.settings.languageChange.value;
      timeString = timeString || 0;
      precision = precision || 2;
      spacer = spacer || ' ';
      if (!isFinite(timeString)) {
        return ' \u221E ';
      }
      if (timeString < 0) timeString *= -1;
      var factors = [];
      var locStr = [];
      factors.year = 31536000;
      factors.month = 2520000;
      factors.day = 86400;
      factors.hour = 3600;
      factors.minute = 60;
      factors.second = 1;
      locStr.year = Constant.LanguageData[lang].year;
      locStr.month = Constant.LanguageData[lang].month;
      locStr.day = Constant.LanguageData[lang].day;
      locStr.hour = Constant.LanguageData[lang].hour;
      locStr.minute = Constant.LanguageData[lang].minute;
      locStr.second = Constant.LanguageData[lang].second;
      timeString = Math.ceil(timeString / 1000);
      var retString = "";
      for (var fact in factors) {
        var timeInSecs = Math.floor(timeString / factors[fact]);
        if (isNaN(timeInSecs)) {
          return retString;
        }
        if (precision > 0 && (timeInSecs > 0 || retString != "")) {
          timeString = timeString - timeInSecs * factors[fact];
          if (retString != "") {
            retString += spacer;
          }
          retString += timeInSecs == 0 ? '' : timeInSecs + locStr[fact];
          precision = timeInSecs == 0 ? precision : (precision - 1);
        }
      }
      return retString;
    },
    FormatFullTimeToDateString: function (timeString, precise) {
      var lang = database.settings.languageChange.value;
      precise = precise || true;
      timeString = timeString || 0;
      var sInDay = 86400000;
      var day = '';
      var compDate = new Date(timeString);
      if (precise) {
        switch (Math.floor(compDate.getTime() / sInDay) - Math.floor($.now() / sInDay)) {
          case 0:
            day = Constant.LanguageData[lang].today;
            break;
          case 1:
            day = Constant.LanguageData[lang].tomorrow;
            break;
          case -1:
            day = Constant.LanguageData[lang].yesterday;
            break;
          default:
            day = (!isChrome ? compDate.toLocaleFormat('%a %d %b') : compDate.toString().split(' ').splice(0, 3).join(' ')); //Dienstag
        }
      }
      if (day !== '') {
        day += ', ';
      }
      return day + compDate.toLocaleTimeString();
    },
    FormatTimeToDateString: function (timeString) {
      timeString = timeString || 0;
      var compDate = new Date(timeString);
      return compDate.toLocaleTimeString();
    },
    FormatRemainingTime: function (time, brackets) {
      brackets = brackets || false;
      var arrInTime = Utils.FormatTimeLengthToStr(time, 3, ' ');
      return (arrInTime === '') ? '' : (brackets ? '(' : '') + arrInTime + (brackets ? ')' : '');
    },
    FormatNumToStr: function (inputNum, outputSign, precision) {
      var lang = database.settings.languageChange.value;
      precision = precision ? "10e" + (precision - 1) : 1;
      var ret, val, sign, i, j;
      var tho = Constant.LanguageData[lang].thousandSeperator;
      var dec = Constant.LanguageData[lang].decimalPoint;
      if (!isFinite(inputNum)) {
        return '\u221E';
      }
      sign = inputNum > 0 ? 1 : inputNum === 0 ? 0 : -1;
      if (sign) {
        val = ((Math.floor(Math.abs(inputNum * precision)) / precision) + '').split('.');
        ret = val[1] !== undefined ? [dec, val[1]] : [];
        val = val[0].split('');
        i = val.length;
        j = 1;
        while (i--) {
          ret.unshift(val.pop());
          if (i && j % 3 === 0) {
            ret.unshift(tho);
          }
          j++;
        }
        if (outputSign) {
          ret.unshift(sign == 1 ? '+' : '-');
        }
        return ret.join('');
      }
      else return inputNum;
    }
  };

  /***********************************************************************************************************************
   * CLASSES
   **********************************************************************************************************************/
  function Movement(id, originCityId, targetCityId, arrivalTime, mission, loadingTime, resources, military, ships) {
    if (typeof id === "object") {
      this._id = id._id || null;
      this._originCityId = id._originCityId || null;
      this._targetCityId = id._targetCityId || null;
      this._arrivalTime = id._arrivalTime || null;
      this._mission = id._mission || null;
      this._loadingTime = id._loadingTime || null;
      this._resources = id._resources || { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0, gold: 0 };
      this._military = id._military || new MilitaryUnits();
      this._ships = id._ships || null;
      this._updatedCity = id._updatedCity || false;
      this._complete = id._complete || false;
      this._updateTimer = id._updateTimer || null;

    } else {
      this._id = id || null;
      this._originCityId = originCityId || null;
      this._targetCityId = targetCityId || null;
      this._arrivalTime = arrivalTime || null;
      this._mission = mission || null;
      this._loadingTime = loadingTime || null;
      this._resources = resources || { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0, gold: 0 };
      this._military = military || new MilitaryUnits();
      this._ships = ships || null;
      this._updatedCity = false;
      this._complete = false;
      this._updateTimer = null;
    }
  }
  Movement.prototype = {
    startUpdateTimer: function () {
      this.clearUpdateTimer();
      if (this.isCompleted) {
        this.updateTransportComplete();
      } else {
        this._updateTimer = events.scheduleActionAtTime(this.updateTransportComplete.bind(this), this._arrivalTime + 1000);
      }
    },
    clearUpdateTimer: function () {
      var ret = !this._updateTimer || this._updateTimer();
      this._updateTimer = null;
      return ret;
    },
    get getId() {
      return this._id;
    },
    get getOriginCityId() {
      return this._originCityId;
    },
    get getTargetCityId() {
      return this._targetCityId;
    },
    get getArrivalTime() {
      return this._arrivalTime;
    },
    get getMission() {
      return this._mission;
    },
    get getLoadingTime() {
      return this._loadingTime - $.now();
    },
    get getResources() {
      return this._resources;
    },
    getResource: function (resourceName) {
      return this._resources[resourceName];
    },
    get getMilitary() {
      return this._military;
    },
    get getShips() {
      return this._ships;
    },
    get isCompleted() {
      return this._arrivalTime < $.now();
    },
    get isLoading() {
      return this._loadingTime > $.now();
    },
    get getRemainingTime() {
      return this._arrivalTime - $.now();
    },
    updateTransportComplete: function () {
      if (this.isCompleted && !this._updatedCity) {
        var city = database.getCityFromId(this._targetCityId);
        var changes = [];
        if (city) {
          for (var resource in Constant.Resources) {
            if (this.getResource(Constant.Resources[resource])) {
              changes.push(Constant.Resources[resource]);
            }
            city.getResource(Constant.Resources[resource]).increment(this.getResource(Constant.Resources[resource]));
          }
          this._updatedCity = true;
          city = database.getCityFromId(this.getOriginCityId);
          if (city) {
            city.updateActionPoints(city.getAvailableActions + 1);
          }
          if (changes.length) {
            events(Constant.Events.MOVEMENTS_UPDATED).pub([this.getTargetCityId]);
            events(Constant.Events.RESOURCES_UPDATED).pub(this.getTargetCityId, changes);
          }
          events.scheduleAction(function () {
            database.getGlobalData.removeFleetMovement(this._id);
          }.bind(this));
          return true;
        }

      } else if (this._updatedCity) {
        events.scheduleAction(function () {
          database.getGlobalData.removeFleetMovement(this._id);
        }.bind(this));
      }
      return false;
    }
  };

  function Resource(city, name) {
    this._current = 0;
    this._production = 0;
    this._consumption = 0;
    this._currentChangedDate = $.now();
    this.city = Utils.wrapInClosure(city);
    this._name = name;
    return this;
  }

  Resource.prototype = {
    get name() {
      return this._name;
    },
    update: function (current, production, consumption) {
      var changed = (current % this._current > 10) || (production != this._production) || (consumption != this._consumption);
      this._current = current;
      this._production = production;
      this._consumption = consumption;
      this._currentChangedDate = $.now();
      return changed;
    },
    project: function () {
      var limit = Math.floor($.now() / 1000);
      var start = Math.floor(this._currentChangedDate / 1000);
      while (limit > start) {
        this._current += this._production;
        if (Math.floor(start / 3600) != Math.floor((start + 1) / 3600))
          if (this._current > this._consumption) {
            this._current -= this._consumption;
          } else {
            this.city().projectPopData(start * 1000);
            this._consumption = 0;
          }

        start++;
      }
      this._currentChangedDate = limit * 1000;
      this.city().projectPopData(limit * 1000);

    },
    increment: function (amount) {
      if (amount !== 0) {
        this._current += amount;
        return true;
      }
      return false;
    },
    get getEmptyTime() {
      var net = this.getProduction * 3600 - this.getConsumption;
      return (net < 0) ? this.getCurrent / net * -1 : Infinity;
    },
    get getFullTime() {
      var net = this.getProduction * 3600 - this.getConsumption;
      return (net > 0) ? (this.city().maxResourceCapacities.capacity - this.getCurrent) / net : 0;
    },
    get getCurrent() {
      return Math.floor(this._current);

    },
    get getProduction() {
      return this._production || 0;
    },
    get getConsumption() {
      return this._consumption || 0;
    }
  };

  function Military(city) {
    this.city = Utils.wrapInClosure(city);
    this._units = new MilitaryUnits();
    this._advisorLastUpdate = 0;
    this.armyTraining = [];
    this._trainingTimer = null;
  }
  Military.prototype = {
    init: function () {
      this._trainingTimer = null;
      this._startTrainingTimer();
    },
    _getTrainingTotals: function () {
      var ret = {};
      $.each(this.armyTraining, function (index, training) {
        $.each(Constant.UnitData, function (unitId, info) {
          ret[unitId] = ret[unitId] ? ret[unitId] + (training.units[unitId] || 0) : training.units[unitId] || 0;
        });
      });
      return ret;
    },
    get getTrainingTotals() {
      if (!this._trainingTotals) {
        this._trainingTotals = Utils.cacheFunction(this._getTrainingTotals.bind(this), 1000);
      }
      return this._trainingTotals();
    },
    _getIncomingTotals: function () {
      var ret = {};
      $.each(this.city().getIncomingMilitary, function (index, element) {
        for (var unitName in Constant.UnitData) {
          ret[unitName] = ret[unitName] ? ret[unitName] + (element.getMilitary.totals[unitName] || 0) : element.getMilitary.totals[unitName] || 0;
        }
      });
      return ret;
    },
    get getIncomingTotals() {
      if (!this._incomingTotals) {
        this._incomingTotals = Utils.cacheFunction(this._getIncomingTotals.bind(this), 1000);
      }
      return this._incomingTotals();
    },
    getTrainingForUnit: function (unit) {
      var ret = [];
      $.each(this.armyTraining, function (index, training) {
        $.each(training.units, function (unitId, count) {
          if (unitId === unit) {
            ret.push({ count: count, time: training.completionTime });
          }
        });
      });
      return ret;
    },
    setTraining: function (trainingQueue) {
      if (!trainingQueue.length) return false;
      this._stopTrainingTimer();
      var type = trainingQueue[0].type;
      var changes = this._clearTrainingForType(type);
      $.each(trainingQueue, function (index, training) {
        this.armyTraining.push(training);
        $.each(training.units, function (unitId, count) {
          changes.push(unitId);
        });
      }.bind(this));
      this.armyTraining.sort(function (a, b) {
        return a.completionTime - b.completionTime;
      });
      this._startTrainingTimer();
      return $.exclusive(changes);
    },
    _clearTrainingForType: function (type) {
      var oldTraining = this.armyTraining.filter(function (item) {
        return item.type === type;
      });
      this.armyTraining = this.armyTraining.filter(function (item) {
        return item.type !== type;
      });
      var changes = [];
      $.each(oldTraining, function (index, training) {
        $.each(training.units, function (unitId, count) {
          changes.push(unitId);
        });
      });
      return changes;
    },
    _completeTraining: function () {
      if (this.armyTraining.length) {
        if (this.armyTraining[0].completionTime < $.now() + 5000) {
          var changes = [];
          var training = this.armyTraining.shift();
          $.each(training.units, function (id, count) {
            this.getUnits.addUnit(id, count);
            changes.push(id);
          }.bind(this));
          if (changes.length) events(Constant.Events.MILITARY_UPDATED).pub(this.city().getId, changes);
        }
      }
      this._startTrainingTimer();
    },
    _startTrainingTimer: function () {
      this._stopTrainingTimer();
      if (this.armyTraining.length) {
        this._trainingTimer = events.scheduleActionAtTime(this._completeTraining.bind(this), this.armyTraining[0].completionTime);
      }
    },
    _stopTrainingTimer: function () {
      if (this._trainingTimer) {
        this._trainingTimer();
      }
      this._trainingTimer = null;
    },
    updateUnits: function (counts) {
      var changes = [];
      $.each(counts, function (unitId, count) {
        if (this._units.setUnit(unitId, count)) {
          changes.push(unitId);
        }
      }.bind(this));
      return changes;
    },
    get getUnits() {
      return this._units;
    }
  };
  function MilitaryUnits(obj) {
    this._units = obj !== undefined ? obj._units : {};
  }
  MilitaryUnits.prototype = {
    getUnit: function (unitId) {
      return this._units[unitId] || 0;
    },
    setUnit: function (unitId, count) {
      var changed = this._units[unitId] != count;
      this._units[unitId] = count;
      return changed;
    },
    get totals() {
      return this._units;
    },
    addUnit: function (unitId, count) {
      return this.setUnit(unitId, this.getUnit(unitId) + count);
    },
    removeUnit: function (unitId, count) {
      count = Math.max(0, this.getUnit[unitId] - count);
      return this.setUnit(unitId, count);
    }
  };

  function Building(city, pos) {
    this._position = pos;
    this._level = 0;
    this._name = null;
    this.city = Utils.wrapInClosure(city);
    this._updateTimer = null;
  }
  Building.prototype = {
    startUpgradeTimer: function () {
      if (this._updateTimer) {
        this._updateTimer();
        delete this._updateTimer;
      }
      if (this._completionTime) {
        if (this._completionTime - $.now() < 5000) {
          this.completeUpgrade();
        } else {
          this._updateTimer = events.scheduleActionAtTime(this.completeUpgrade.bind(this), this._completionTime - 4000);
        }
      }
      var statusPoll = function (a, b) {
        return events.scheduleActionAtInterval(function () {
          if (a != this.isUpgradable || b != this.isUpgrading) {
            var changes = { position: this._position, name: this.getName, upgraded: this.isUpgrading != b };
            events(Constant.Events.BUILDINGS_UPDATED).pub([changes]);
            a = this.isUpgradable;
            b = this.isUpgrading;
          }
        }.bind(this), 3000);
      }(this.isUpgradable, this.isUpgrading);
    },
    update: function (data) {
      var changes;
      var name = data.building.split(' ')[0];
      var level = parseInt(data.level) || 0;
      database.getGlobalData.addLocalisedString(name, data.name);
      var completion = ('undefined' !== typeof data.completed) ? parseInt(data.completed) : 0;
      var changed = (name !== this._name || level !== this._level || !!completion != this.isUpgrading); // todo
      if (changed) {
        changes = { position: this._position, name: this.getName, upgraded: this.isUpgrading != !completion }; //todo
      }
      if (completion) {
        this._completionTime = completion * 1000;
        this.startUpgradeTimer();
      } else if (this._completionTime) {
        delete this._completionTime;
      }
      this._name = name;
      this._level = level;
      if (changed) {
        return changes;
      }
      return false;
    },
    get getUrlParams() {
      return {
        view: this.getName,
        cityId: this.city().getId,
        position: this.getPosition
      };
    },
    get getUpgradeCost() {
      var carpenter, architect, vineyard, fireworker, optician;
      var level = this._level + this.isUpgrading;
      if (this.isEmpty) {
        return {
          wood: Infinity,
          glass: 0,
          marble: 0,
          sulfur: 0,
          wine: 0,
          time: 0
        };
      }
      var time = Constant.BuildingData[this._name].time;
      var bon = 1;
      var bonTime = 1 + Constant.GovernmentData[database.getGlobalData.getGovernmentType].buildingTime;
      bon -= database.getGlobalData.getResearchTopicLevel(Constant.Research.Economy.PULLEY) ? 0.02 : 0;
      bon -= database.getGlobalData.getResearchTopicLevel(Constant.Research.Economy.GEOMETRY) ? 0.04 : 0;
      bon -= database.getGlobalData.getResearchTopicLevel(Constant.Research.Economy.SPIRIT_LEVEL) ? 0.08 : 0;
      return {
        wood: Math.floor((Constant.BuildingData[this._name].wood[level] || 0) * (bon - (carpenter = this.city().getBuildingFromName(Constant.Buildings.CARPENTER), carpenter ? carpenter.getLevel / 100 : 0))),
        wine: Math.floor((Constant.BuildingData[this._name].wine[level] || 0) * (bon - (vineyard = this.city().getBuildingFromName(Constant.Buildings.VINEYARD), vineyard ? vineyard.getLevel / 100 : 0))),
        marble: Math.floor((Constant.BuildingData[this._name].marble[level] || 0) * (bon - (architect = this.city().getBuildingFromName(Constant.Buildings.ARCHITECT), architect ? architect.getLevel / 100 : 0))),
        glass: Math.floor((Constant.BuildingData[this._name].glass[level] || 0) * (bon - (optician = this.city().getBuildingFromName(Constant.Buildings.OPTICIAN), optician ? optician.getLevel / 100 : 0))),
        sulfur: Math.floor((Constant.BuildingData[this._name].sulfur[level] || 0) * (bon - (fireworker = this.city().getBuildingFromName(Constant.Buildings.FIREWORK_TEST_AREA), fireworker ? fireworker.getLevel / 100 : 0))),
        time: Math.round(time.a / time.b * Math.pow(time.c, level + 1) - time.d) * 1000 * bonTime
      };
    },
    get getName() {
      return this._name;
    },
    get getType() {
      return Constant.BuildingData[this.getName].type;
    },
    get getLevel() {
      return this._level;
    },
    get isEmpty() {
      return this._name == 'buildingGround' || this._name === null;
    },
    get isUpgrading() {
      return (this._completionTime > $.now());
    },
    subtractUpgradeResourcesFromCity: function () {
      var cost = this.getUpgradeCost;
      $.each(Constant.Resources, function (key, resourceName) {
        this.city().getResource(resourceName).increment(cost[resourceName] * -1);
      }.bind(this));
      this._completionTime = $.now() + cost.time;
    },
    get isUpgradable() {
      if (this.isEmpty || this.isMaxLevel) {
        return false;
      }
      var cost = this.getUpgradeCost;
      var upgradable = true;
      $.each(Constant.Resources, function (key, value) {
        upgradable = upgradable && (!cost[value] || cost[value] <= this.city().getResource(value).getCurrent);
      }.bind(this));
      return upgradable;
    },
    get getCompletionTime() {
      return this._completionTime;
    },
    get getCompletionDate() {
    },
    get isMaxLevel() {
      return Constant.BuildingData[this.getName].maxLevel === (this.getLevel);
    },
    get getPosition() {
      return this._position;
    },
    completeUpgrade: function () {
      this._level++;
      delete this._completionTime;
      delete this._updateTimer;
      events(Constant.Events.BUILDINGS_UPDATED).pub(this.city().getId, [
        { position: this._position, name: this.getName, upgraded: true }
      ]);
    }
  };

  function CityResearch(city) {
    this._researchersLastUpdate = 0;
    this._researchers = 0;
    this._researchCostLastUpdate = 0;
    this._researchCost = 0;
    this.city = Utils.wrapInClosure(city);
  }

  CityResearch.prototype = {
    updateResearchers: function (researchers) {
      var changed = this._researchers !== researchers;
      this._researchers = researchers;
      this._researchersLastUpdate = $.now();
      this._researchCost = this.getResearchCost;
      return changed;
    },
    updateCost: function (cost) {
      var changed = this._researchCost !== cost;
      this._researchCost = cost;
      this._researchCostLastUpdate = $.now();
      this._researchers = this.getResearchers;
      return changed;
    },
    get getResearchers() {
      if (this._researchersLastUpdate < this._researchCostLastUpdate) {
        return Math.floor(this._researchCost / this._researchCostModifier);
      } else {
        return this._researchers;
      }
    },
    get getResearch() {
      return this.researchData.total;
    },
    get researchData() {
      if (!this._researchData) {
        this._researchData = Utils.cacheFunction(this.researchDataCached.bind(this), 1000);
      }
      return this._researchData();
    },
    researchDataCached: function () {
      var resBon = 0 + (database.getGlobalData.getResearchTopicLevel(Constant.Research.Science.PAPER) * 0.02) + (database.getGlobalData.getResearchTopicLevel(Constant.Research.Science.INK) * 0.04) + (database.getGlobalData.getResearchTopicLevel(Constant.Research.Science.MECHANICAL_PEN) * 0.08) + (database.getGlobalData.getResearchTopicLevel(Constant.Research.Science.SCIENTIFIC_FUTURE) * 0.02);
      var premBon = database.getGlobalData.hasPremiumFeature(Constant.Premium.RESEARCH_POINTS_BONUS_EXTREME_LENGTH) ? (0 + Constant.PremiumData[Constant.Premium.RESEARCH_POINTS_BONUS_EXTREME_LENGTH].bonus) : database.getGlobalData.hasPremiumFeature(Constant.Premium.RESEARCH_POINTS_BONUS) ? (0 + Constant.PremiumData[Constant.Premium.RESEARCH_POINTS_BONUS].bonus) : 0;
      var goods = Constant.GovernmentData[database.getGlobalData.getGovernmentType].researchPerCulturalGood * this.city()._culturalGoods;
      var researchers = this.getResearchers;
      var corruptionSpend = researchers * this.city().getCorruption;
      var nonCorruptedResearchers = researchers * (1 - this.city().getCorruption);
      var premiumResBonus = nonCorruptedResearchers * premBon;
      var researchBonus = nonCorruptedResearchers * resBon;
      var premiumGoodsBonus = goods * premBon;
      var serverTyp = 1;
      if (ikariam.Server() == 's201' || ikariam.Server() == 's202') serverTyp = 3;
      return {
        scientists: researchers,
        researchBonus: researchBonus,
        premiumScientistBonus: premiumResBonus,
        premiumResearchBonus: (researchBonus * premBon),
        culturalGoods: goods,
        premiumCulturalGoodsBonus: premiumGoodsBonus,
        corruption: corruptionSpend,
        total: ((nonCorruptedResearchers + researchBonus + premiumResBonus + goods + premiumGoodsBonus + (researchBonus * premBon)) * Constant.GovernmentData[database.getGlobalData.getGovernmentType].researchBonus) * serverTyp
      };
    },
    get _researchCostModifier() {
      var serverTyp = 1;
      if (ikariam.Server() == 's201' || ikariam.Server() == 's202') serverTyp = 3;
      return (6 + Constant.GovernmentData[database.getGlobalData.getGovernmentType].researcherCost - (database.getGlobalData.getResearchTopicLevel(Constant.Research.Science.LETTER_CHUTE) * 3)) * serverTyp;
    },
    get getResearchCost() {
      return this.getResearchers * this._researchCostModifier;
    }
  };

  function Changes(city, type, changes) {
    this.city = city || null;
    this.type = type || null;
    this.changes = changes || [];
  }
  function Population(city) {
    this._population = 0;
    this._citizens = 0;
    this._resourceWorkers = 0;
    this._tradeWorkers = 0;
    this._priests = 0;
    this._culturalGoods = 0;

    this._popChanged = $.now();
    this._citizensChanged = $.now();
    this._culturalGoodsChanged = $.now();
    this._priestsChanged = $.now();
    this.city = Utils.wrapInClosure(city);
  }
  Population.prototype = {
    updatePopulationData: function (population, citizens, priests, culturalGoods) {
      var changes = [];
      if (population && population != this._population) {
        changes.push({ population: true });
        this.population = population;
      }
      if (citizens && citizens != this._priests) {
        changes.push({ citizens: true });
        this.citizens = citizens;
      }
      if (priests && priests != this._priests) {
        changes.push({ priests: true });
        this.priests = priests;
      }
    },
    updateWorkerData: function (resourceName, workers) {
    },
    updatePriests: function (newCount) {
    },
    updateCulturalGoods: function (newCount) {
    },
    get population() {
      return this._population;
    },
    set population(newVal) {
      this._population = newVal;
      this._popChanged = $.now();
    },
    get citizens() {
      return this._citizens;
    },
    set citizens(newVal) {
      this._citizens = newVal;
      this._citizensChanged = $.now();
    },
    get priests() {
      return this._priests;
    },
    set priests(newVal) {
      this._priests = newVal;
      this._priestsChanged = $.now();
    }
  };

  function City(id) {
    this._id = id || 0;
    this._name = '';
    this._resources = {
      gold: new Resource(this, Constant.Resources.GOLD),
      wood: new Resource(this, Constant.Resources.WOOD),
      wine: new Resource(this, Constant.Resources.WINE),
      marble: new Resource(this, Constant.Resources.MARBLE),
      glass: new Resource(this, Constant.Resources.GLASS),
      sulfur: new Resource(this, Constant.Resources.SULFUR)
    };
    this._capacities = {
      capacity: 0,
      safe: 0,
      buildings: {
        dump: { storage: 0, safe: 0 },
        warehouse: { storage: 0, safe: 0 },
        townHall: { storage: 2500, safe: 100 }
      },
      invalid: true
    };
    this._tradeGoodID = 0;
    this.knownTime = $.now();
    this._lastPopUpdate = $.now();
    //    this._buildings = new Array(25);
    this._buildings = new Array(Math.max($('#locations [id^="position"]').length, 25));
    var i = this._buildings.length;
    while (i--) {
      this._buildings[i] = new Building(this, i);
    }
    this._research = new CityResearch(this);
    this.actionPoints = 0;
    this._actionPoints = 0;
    this.maxSci = 0;
    this._coordinates = { x: 0, y: 0 };
    this._islandID = null;

    this.population = new Population(this);
    this._population = 0;
    this._citizens = 0;
    this._resourceWorkers = 0;
    this._tradeWorkers = 0;
    this._priests = 0;
    this._culturalGoods = 0;
    this._military = new Military(this);

    this.fleetMovements = {};
    this.militaryMovements = {};
    this.unitBuildList = [];

    this.goldIncome = 0;
    this.goldExpend = 0;

    this._pop = { currentPop: 0, maxPop: 0, satisfaction: { city: 196, museum: { cultural: 0, level: 0 }, government: 0, tavern: { wineConsumption: 0, level: 0 }, research: 0, priest: 0, total: 0 }, happiness: 0, growth: 0 };
    events('updateCityData').sub(this.updateCityDataFromAjax.bind(this));
    events('updateBuildingData').sub(this.updateBuildingsDataFromAjax.bind(this));
  }

  City.prototype = {
    init: function () {
      $.each(this._buildings, function (idx, building) {
        building.startUpgradeTimer();
      });
      this.military.init();
      $.each(this._resources, function (resourceName, resource) {
        resource.project();
      });
      events.scheduleActionAtInterval(function () {
        $.each(this._resources, function (resourceName, resource) {
          resource.project();
        }.bind(this));
      }.bind(this), 1000);
    },
    projectResource: function (seconds) {
    },
    updateBuildingsDataFromAjax: function (id, position) {
      var changes = [];
      if (id == this.getId && ikariam.viewIsCity) {
        if (position) {
          $.each(position, function (i, item) {
            var change = this.getBuildingFromPosition(i).update(item);
            if (change) changes.push(change);
          }.bind(this));
          if (changes.length) {
            this._capacities.invalid = true;
            events(Constant.Events.BUILDINGS_UPDATED).pub(id, changes);
          }
        }
      }
    },
    updateCityDataFromAjax: function (id, cityData) {
      var resourcesChanged = false;
      var changes = {};
      if (id == this.getId) {
        try {
          var baseWineConsumption = 0, wineConsumption = 0;
          if ($.inArray(cityData.wineSpendings, Constant.BuildingData[Constant.Buildings.TAVERN].wineUse, Constant.BuildingData[Constant.Buildings.TAVERN].wineUse2) > -1) {
            baseWineConsumption = cityData.wineSpendings;
            wineConsumption = (this.getBuildingFromName(Constant.Buildings.VINEYARD)) ? baseWineConsumption * ((100 - this.getBuildingFromName(Constant.Buildings.VINEYARD).getLevel) / 100) : baseWineConsumption;
          }
          else {
            wineConsumption = cityData.wineSpendings;
          }
          this.updateTradeGoodID(parseInt(cityData.producedTradegood));
          resourcesChanged = this.updateResource(Constant.Resources.WOOD, cityData.currentResources[Constant.ResourceIDs.WOOD], cityData.resourceProduction, 0) || resourcesChanged;
          resourcesChanged = this.updateResource(Constant.Resources.WINE, cityData.currentResources[Constant.ResourceIDs.WINE], this.getTradeGoodID == Constant.ResourceIDs.WINE ? cityData.tradegoodProduction : 0, wineConsumption) || resourcesChanged;
          resourcesChanged = this.updateResource(Constant.Resources.MARBLE, cityData.currentResources[Constant.ResourceIDs.MARBLE], this.getTradeGoodID == Constant.ResourceIDs.MARBLE ? cityData.tradegoodProduction : 0, 0) || resourcesChanged;
          resourcesChanged = this.updateResource(Constant.Resources.GLASS, cityData.currentResources[Constant.ResourceIDs.GLASS], this.getTradeGoodID == Constant.ResourceIDs.GLASS ? cityData.tradegoodProduction : 0, 0) || resourcesChanged;
          resourcesChanged = this.updateResource(Constant.Resources.SULFUR, cityData.currentResources[Constant.ResourceIDs.SULFUR], this.getTradeGoodID == Constant.ResourceIDs.SULFUR ? cityData.tradegoodProduction : 0, 0) || resourcesChanged;
          this.knownTime = $.now();

          var $actionPointElem = $('#js_GlobalMenu_maxActionPoints');
          if (cityData.maxActionPoints) {
            changes.actionPoints = this.updateActionPoints(cityData.maxActionPoints || 0);
          } else {
            changes.actionPoints = this.updateActionPoints(parseInt($actionPointElem.text()) || 0);
          }
          changes.coordinates = this.updateCoordinates(parseInt(cityData.islandXCoord), parseInt(cityData.islandYCoord));
          if (ikariam.viewIsCity) {
            changes.name = this.updateName(cityData.name);
            changes.population = this.updatePopulation(cityData.currentResources.population);
            changes.islandId = this.updateIslandID(parseInt(cityData.islandId));
            changes.coordinates = this.updateCoordinates(parseInt(cityData.islandXCoord), parseInt(cityData.islandYCoord));
          }
          if (ikariam.viewIsIsland) {
            changes.islandId = this.updateIslandID(parseInt(cityData.id));
            changes.coordinates = this.updateCoordinates(parseInt(cityData.xCoord), parseInt(cityData.yCoord));
          }
          changes.citizens = this.updateCitizens(cityData.currentResources.citizens);
          database.getGlobalData.addLocalisedString('cities', $('#js_GlobalMenu_cities').find('> span').text());
          database.getGlobalData.addLocalisedString('ActionPoints', $actionPointElem.attr('title'));
          if (cityData.gold) {
            database.getGlobalData.finance.currentGold = parseFloat(cityData.gold);
          }
        } catch (e) {
          empire.error('fetchCurrentCityData', e);
        } finally {
          cityData = null;
        }
        events(Constant.Events.CITY_UPDATED).pub(this.getId, changes);
        if (resourcesChanged) {
          events(Constant.Events.RESOURCES_UPDATED).pub(this.getId, resourcesChanged);
        }
      }
    },
    get getCorruption() {
      if (typeof this._corruption != "function") {
        this._corruption = Utils.cacheFunction(function () {
          var h = 0;
          if (this.getBuildingFromName(Constant.Buildings.GOVERNORS_RESIDENCE) && (this.getBuildingFromName(Constant.Buildings.GOVERNORS_RESIDENCE).getLevel / database.getCityCount != 1)) {
            h = Constant.GovernmentData[database.getGlobalData.getGovernmentType].governors;
          }
          return Math.max(0, 1 - ((this.getBuildingFromName(Constant.Buildings.GOVERNORS_RESIDENCE) ? this.getBuildingFromName(Constant.Buildings.GOVERNORS_RESIDENCE).getLevel : this.getBuildingFromName(Constant.Buildings.PALACE) ? this.getBuildingFromName(Constant.Buildings.PALACE).getLevel : 0) + 1) / database.getCityCount + Constant.GovernmentData[database.getGlobalData.getGovernmentType].corruption + h);
        }.bind(this), 1000);
      }
      return this._corruption();
    },
    get isCurrentCity() {
      return this.getId == ikariam.CurrentCityId;
    },
    getResource: function (name) {
      return this._resources[name];
    },
    updateResource: function (resourceName, current, production, consumption) {
      return this.getResource(resourceName).update(current, production, consumption);
    },
    get getIncome() {
      var priestsGold = 0;
      var serverTyp = 1;
      if (ikariam.Server() == 's202') serverTyp = 3;
      priestsGold = Math.floor(this._priests * Constant.GovernmentData[database.getGlobalData.getGovernmentType].goldBonusPerPriest);
      return this._citizens * 3 * serverTyp + priestsGold;
    },
    updateIncome: function (value) {
      /*  if(Math.abs(this._citizens - value / 3) > 2) {
          return this.updateCitizens((value / 3))
        }*/
      return false;
    },
    get getExpenses() {
      return -1 * this._research.getResearchCost;
    },
    updateExpenses: function (value) {
      return this._research.updateCost(Math.abs(value));
    },
    get getBuildings() {
      return this._buildings;
    },
    getBuildingsFromName: function (name) {
      var ret = [];
      var i = this._buildings.length;
      while (i--) {
        if (this._buildings[i].getName == name) ret.push(this._buildings[i]);
      }
      return ret;
    },
    getBuildingFromName: function (name) {
      var i = this._buildings.length;
      while (i--) {
        if (this._buildings[i].getName == name)
          return this._buildings[i];
      }
      return null;
    },
    getBuildingFromPosition: function (position) {
      return this._buildings[position];
    },
    getWonder: function () {
      var i = 7;//ikariam.wonder();
      return i;
    },
    get getTradeGood() {
      for (var resourceName in Constant.ResourceIDs) {
        if (this._tradeGoodID == Constant.ResourceIDs[resourceName]) {
          return Constant.Resources[resourceName];
        }
      }
      return null;
    },
    get getTradeGoodID() {
      return this._tradeGoodID;
    },
    updateTradeGoodID: function (value) {
      var changed = this._tradeGoodID != value;
      if (changed) {
        this._tradeGoodID = value;
      }
      return changed;
    },
    updatePriests: function (priests) {
      var changed = this._priests != priests;
      this._priests = priests;
      return changed;
    },
    get getName() {
      return this._name;
    },
    updateName: function (value) {
      var changed = this._name != value;
      if (changed) {
        this._name = value;
      }
      return changed;
    },
    get getId() {
      return this._id;
    },
    get research() {
      return this._research;
    },
    updateResearchers: function (value) {
      return this._research.updateResearchers(value);
    },
    updateResearchCost: function (value) {
      return this._research.updateCost(value);
    },
    get garrisonland() {
      var i = 0, r = 0, t = 0;
      if (this.getBuildingFromName(Constant.Buildings.TOWN_HALL)) {
        i = this.getBuildingFromName(Constant.Buildings.TOWN_HALL).getLevel;
      }
      if (this.getBuildingFromName(Constant.Buildings.WALL)) {
        r = this.getBuildingFromName(Constant.Buildings.WALL).getLevel;
      }
      t = (i + r - 1) * 50 + 300;
      return t;
    },
    get garrisonsea() {
      var t = 0, n = 0, s = 0;
      if (this.getBuildingFromName(Constant.Buildings.TRADING_PORT)) { //todo
        t = this.getBuildingFromName(Constant.Buildings.TRADING_PORT).getLevel;
      }
      if (this.getBuildingFromName(Constant.Buildings.SHIPYARD)) {
        s = this.getBuildingFromName(Constant.Buildings.SHIPYARD).getLevel;
      }
      //n = t > t ? t : t > s ? t : s;
      n = t > s ? t : s;
      return n * 25 + 125;
    },
    get plundergold() {
      var i = 0;
      if (this.getBuildingFromName(Constant.Buildings.PALACE)) {
        i = Math.floor(this.getBuildingFromName(Constant.Buildings.TOWN_HALL).getLevel) * 950;
      } else
        if (database.getCityCount == 1)
          i = Math.floor(this.getBuildingFromName(Constant.Buildings.TOWN_HALL).getLevel) * 950;
      return i;
    },
    get maxculturalgood() {
      var i = 0;
      if (this.getBuildingFromName(Constant.Buildings.MUSEUM)) {
        i = this.getBuildingFromName(Constant.Buildings.MUSEUM).getLevel;
      }
      return i;
    },
    get maxtavernlevel() {
      var i = 0;
      if (this.getBuildingFromName(Constant.Buildings.TAVERN)) {
        i = this.getBuildingFromName(Constant.Buildings.TAVERN).getLevel;
      }
      return i;
    },
    get tavernlevel() {
      var wineUse;
      var i;
      if (this.getBuildingFromName(Constant.Buildings.TAVERN)) {
        wineUse = Constant.BuildingData[Constant.Buildings.TAVERN].wineUse;
        if (ikariam.Server() == 's202')
          wineUse = Constant.BuildingData[Constant.Buildings.TAVERN].wineUse2;
        var consumption = Math.floor(this.getResource(Constant.Resources.WINE).getConsumption * (100 / (100 - (this.getBuildingFromName(Constant.Buildings.VINEYARD) ? this.getBuildingFromName(Constant.Buildings.VINEYARD).getLevel : 0))));
        for (i = 0; i < wineUse.length; i++) {
          if (Math.abs(wineUse[i] - consumption) <= 1) {
            break;
          }
        }
      }
      return i > 0 ? i : '';
    },
    get CorruptionCity() {
      var i = Math.max(0, 1 - ((this.getBuildingFromName(Constant.Buildings.GOVERNORS_RESIDENCE) ? this.getBuildingFromName(Constant.Buildings.GOVERNORS_RESIDENCE).getLevel : this.getBuildingFromName(Constant.Buildings.PALACE) ? this.getBuildingFromName(Constant.Buildings.PALACE).getLevel : 0) + 1) / database.getCityCount + Constant.GovernmentData[database.getGlobalData.getGovernmentType].corruption);
      var h = 0;
      if (this.getBuildingFromName(Constant.Buildings.GOVERNORS_RESIDENCE) && (this.getBuildingFromName(Constant.Buildings.GOVERNORS_RESIDENCE).getLevel / database.getCityCount != 1)) {
        h = Constant.GovernmentData[database.getGlobalData.getGovernmentType].governors;
      }
      return Math.floor(i * 100) + (h * 100);
    },
    get maxAP() {
      var i = 0;
      if (this.getBuildingFromName(Constant.Buildings.TOWN_HALL)) {
        i = this.getBuildingFromName(Constant.Buildings.TOWN_HALL).getLevel;
      }
      return Constant.BuildingData[Constant.Buildings.TOWN_HALL].actionPointsMax[i];
    },
    get maxSci() {
      //var i = 0;
      var i;
      if (this.getBuildingFromName(Constant.Buildings.ACADEMY)) {
        i = this.getBuildingFromName(Constant.Buildings.ACADEMY).getLevel;
      }
      return Constant.BuildingData[Constant.Buildings.ACADEMY].maxScientists[i] || '';
    },
    get iSci() {
      var i = '';
      if (this.getBuildingFromName(Constant.Buildings.ACADEMY)) {
        i = 0;
      }
      return i;
    },
    get storageCapacity() {
      return null;
    },
    get getAvailableActions() {
      return this._actionPoints;
    },
    updateActionPoints: function (value) {
      var changed = this._actionPoints != value;
      this._actionPoints = value;
      return changed;
    },
    get getCoordinates() {
      return (this._coordinates ? [this._coordinates.x, this._coordinates.y] : null);
    },
    updateCoordinates: function (x, y) {
      this._coordinates = { x: x, y: y };
      return false;
    },
    get getIslandID() {
      return this._islandID;
    },
    updateIslandID: function (id) {
      this._islandID = id;
      return false;
    },
    get getCulturalGoods() {
      return this._culturalGoods;
    },
    updateCulturalGoods: function (value) {
      var changed = this._culturalGoods !== value;
      if (changed) {
        this._culturalGoods = value;
      }
      return changed;
    },
    get getIncomingResources() {
      return database.getGlobalData.getResourceMovementsToCity(this.getId);
    },
    get getIncomingMilitary() {
      return database.getGlobalData.getMilitaryMovementsToCity(this.getId);
    },
    get _getMaxPopulation() {
      var mPop = 0;
      if (this.getBuildingFromName(Constant.Buildings.TOWN_HALL)) {
        mPop = Math.floor((10 * Math.pow(this.getBuildingFromName(Constant.Buildings.TOWN_HALL).getLevel, 1.5))) * 2 + 40;
      }
      if (database.getGlobalData.getResearchTopicLevel(Constant.Research.Science.WELL_CONSTRUCTION) && (this.getBuildingFromName(Constant.Buildings.PALACE) || database.getCityCount == 1)) {
        mPop += 50;
      }
      if (database.getGlobalData.getResearchTopicLevel(Constant.Research.Economy.UTOPIA) && this.getBuildingFromName(Constant.Buildings.PALACE)) {
        mPop += 200;
      }
      if (database.getGlobalData.getResearchTopicLevel(Constant.Research.Economy.HOLIDAY)) {
        mPop += 50;
      }
      mPop += database.getGlobalData.getResearchTopicLevel(Constant.Research.Economy.ECONOMIC_FUTURE) * 20;
      return mPop;
    },
    get military() {
      return this._military;
    },
    get getAvailableBuildings() {
      var p = 0;
      //      var i = 22 + database.getGlobalData.getResearchTopicLevel(Constant.Research.Economy.BUREACRACY) + database.getGlobalData.getResearchTopicLevel(Constant.Research.Seafaring.PIRACY);
      var i = this.getBuildings.length + database.getGlobalData.getResearchTopicLevel(Constant.Research.Economy.BUREACRACY) + database.getGlobalData.getResearchTopicLevel(Constant.Research.Seafaring.PIRACY) - 2;
      $.each(this.getBuildings, function (idx, building) {
        i -= !building.isEmpty;
      });
      if (database.settings.noPiracy.value && database.getGlobalData.getResearchTopicLevel(Constant.Research.Seafaring.PIRACY))
        p = 1;
      return i - p;
    },
    get maxResourceCapacities() {
      if (!this._capacities.invalid) {
        return this._capacities;
      }
      var lang = database.settings.languageChange.value;
      var ret = {};
      ret[Constant.Buildings.DUMP] = { storage: 0, safe: 0, lang: Constant.LanguageData[lang].dump };
      ret[Constant.Buildings.WAREHOUSE] = { storage: 0, safe: 0, lang: Constant.LanguageData[lang].warehouse };
      ret[Constant.Buildings.TOWN_HALL] = { storage: 2500, safe: 100, lang: Constant.LanguageData[lang].townHall };
      $.each(this.getBuildingsFromName(Constant.Buildings.WAREHOUSE), function (i, building) {
        ret[Constant.Buildings.WAREHOUSE].storage += building.getLevel * 8000;
        ret[Constant.Buildings.WAREHOUSE].safe += building.getLevel * 480;
      });
      $.each(this.getBuildingsFromName(Constant.Buildings.DUMP), function (i, building) {
        ret[Constant.Buildings.DUMP].storage += building.getLevel * 32000;
      });
      var capacity = 0;
      var safe = 0;
      for (var key in ret) {
        capacity += ret[key].storage;
        safe += ret[key].safe;
      }
      this._capacities = {
        capacity: capacity * (1 + (database.getGlobalData.hasPremiumFeature(Constant.Premium.STORAGECAPACITY_BONUS) * Constant.PremiumData[Constant.Premium.STORAGECAPACITY_BONUS].bonus)),
        safe: safe * (1 + (database.getGlobalData.hasPremiumFeature(Constant.Premium.SAFECAPACITY_BONUS) * Constant.PremiumData[Constant.Premium.SAFECAPACITY_BONUS].bonus)),
        buildings: ret
      };
      return this._capacities;
    },
    get _getSatisfactionData() {
      var r = {
        city: 196,
        museum: {
          cultural: 0,
          level: 0
        },
        government: 0,
        tavern: {
          wineConsumption: 0,
          level: 0
        },
        research: 0,
        priest: 0,
        total: 0
      };
      if (this.getBuildingFromName(Constant.Buildings.MUSEUM)) {
        var eventBonus = 0;  //Bonus für Serverwechsel/Merge
        var museumLevelBonus = [20, 41, 63, 88, 114, 144, 176, 211, 250, 294, 341, 395, 453, 518, 590, 670, 759, 857, 965, 1086, 1219, 1367, 1530, 1711, 1912, 2134, 2380, 2652, 2953, 3286, 3655, 4064, 4516, 5016, 5569, 6182]
        r.museum.cultural = this.getCulturalGoods * 50 + eventBonus;
        r.museum.level = museumLevelBonus[this.getBuildingFromName(Constant.Buildings.MUSEUM).getLevel - 1];
      }
      //r.government = Constant.GovernmentData[database.getGlobalData.getGovernmentType].happiness + (Constant.GovernmentData[database.getGlobalData.getGovernmentType].happinessWithoutTemple * (this.getBuildingFromName(Constant.Buildings.TEMPLE) == undefined)); //todo
      r.government = Constant.GovernmentData[database.getGlobalData.getGovernmentType].happiness
      if (this.getBuildingFromName(Constant.Buildings.TAVERN)) {
        var wineUse;
        // if (ikariam.Server() == 's202' || ikariam.Server() == 's302') {
        //   wineUse = Constant.BuildingData[Constant.Buildings.TAVERN].wineUse2;
        // } else {
        // wineUse = Constant.BuildingData[Constant.Buildings.TAVERN].wineUse;
        wineUse = Constant.BuildingData[Constant.Buildings.TAVERN].wineUse2;
        // }

        var tavernLevelSatisfaction = Constant.BuildingData[Constant.Buildings.TAVERN].wineUse2;
        var tavernWineSatisfaction = Constant.BuildingData[Constant.Buildings.TAVERN].wineUse3;

        var tavernLevel = this.getBuildingFromName(Constant.Buildings.TAVERN).getLevel
        r.tavern.level = tavernLevelSatisfaction[tavernLevel];

        // TODO: Fix this as it currently assumes tavern is serving maximum drinks based on level. 
        r.tavern.wineConsumption = tavernWineSatisfaction[tavernLevel]

        // I can't figure out how this code below has anything to do with satisfaction. If it used to guess the current slider level, it is certainly wrong.
        // var tavernLevelConsumption = [60,120,181,242,304,367,430,494,559,624,691,758,826,896,966,1037,1109,1182,1256,1332,1408,1485,1564,1644,1725,1807,1891,1975,2061,2149,2238,2328,2419,2512,2606,2702,2800,2898,2999,3101,3204,3310,3416,3525,3635,3747,3861,3976,4094,4213,4334,4457,4582,4709,4838,4969,5103,5238,5375,5515,5657,5801,5947,6096,6247,6400,6556,6714,6875,7038];
        // var consumption = Math.floor(this.getResource(Constant.Resources.WINE).getConsumption * (100 / (100 - (this.getBuildingFromName(Constant.Buildings.VINEYARD) ? this.getBuildingFromName(Constant.Buildings.VINEYARD).getLevel : 0))));
        // for (var i = 0; i < wineUse.length; i++) {
        // if (Math.abs(wineUse[i] - consumption) <= 1) {
        // GM_log("consumption: " + consumption + ", wineUse: " + wineUse[i])
        // r.tavern.wineConsumption = 60 * i;
        // r.tavern.wineConsumption = wineUse[i]
        // r.tavern.wineConsumption = tavernLevelConsumption[i - 1]
        // break;
        // }
        // }
      }
      r.research = (database.getGlobalData.getResearchTopicLevel(2080) * 25) + (database.getGlobalData.getResearchTopicLevel(2999) * 10) + (this.getBuildingFromName(Constant.Buildings.PALACE) ? 50 * database.getGlobalData.getResearchTopicLevel(3010) : 0) + (this.getBuildingFromName(Constant.Buildings.PALACE) ? 200 * database.getGlobalData.getResearchTopicLevel(2120) : 0) + (database.getCityCount == 1 ? 50 * database.getGlobalData.getResearchTopicLevel(3010) : 0) - (this.getBuildingFromName(Constant.Buildings.PALACE) && database.getCityCount == 1 ? 50 * database.getGlobalData.getResearchTopicLevel(3010) : 0);
      r.priest = this._priests * 500 / this._getMaxPopulation * Constant.GovernmentData[database.getGlobalData.getGovernmentType].happinessBonusWithTempleConversion;
      r.priest = (r.priest <= 150 ? r.priest : 150);
      r.city = 196;
      var total = 0;
      for (var n in r) {
        if (typeof r[n] === 'object') {
          for (var o in r[n]) {
            total += r[n][o];
          }
        } else {
          total += r[n];
        }
      }
      r.total = total;
      r.corruption = Math.round(this._population + this._pop.happiness - total);
      return r;
    },
    updatePopulation: function (population) {
      var changed = this._population != population;
      this._population = population;
      this._lastPopUpdate = $.now();
      return changed;
    },
    updateCitizens: function (citizens) {
      var changed = this._citizens != citizens;
      this._citizens = citizens;
      this._lastPopUpdate = $.now();
      return changed;
    },
    projectPopData: function (untilTime) {
      var serverTyp = 1;
      if (ikariam.Server() == 's201' || ikariam.Server() == 's202') serverTyp = 3;
      var plus = this._getSatisfactionData;
      // GM_log(plus);
      var maxPopulation = this._getMaxPopulation;
      var happiness = (1 - this.getCorruption) * plus.total - this._population;
      var hours = ((untilTime - this._lastPopUpdate) / 3600000);
      var pop = this._population + happiness * (1 - Math.pow(Math.E, -(hours / 50)));
      pop = (pop > maxPopulation) ? this._population > maxPopulation ? this._population : maxPopulation : pop;
      happiness = ((1 - this.getCorruption) * plus.total - pop);
      this._citizens = this._citizens + pop - this._population;
      this._population = pop;
      this._lastPopUpdate = untilTime;
      var old = $.extend({}, this._pop);
      this._pop = { currentPop: pop, maxPop: maxPopulation, satisfaction: plus, happiness: happiness, growth: happiness * 0.02 * serverTyp };
      if (Math.floor(old.currentPop) != Math.floor(this._pop.currentPop) || Math.floor(old.maxPop) != Math.floor(this._pop.maxPop) || Math.floor(old.happiness) != Math.floor(this._pop.happiness)) {
        events(Constant.Events.CITY_UPDATED).pub(this.getId, { population: true });
      }
    },
    get populationData() {
      return this._pop;
    },
    processUnitBuildList: function () {
      var newList = [];
      var j;
      for (var i = 0; i < this.unitBuildList.length; i++) {
        var list = this.unitBuildList[i];
        if (list.completionTime <= $.now()) {
          for (var uID in list.units) {
            j = this.army.length;
          }
          while (j) {
            j--;
            if (uID == this.army[j].id) {
              this.army[uID] += list.units[uID];
            }
          }
        } else {
          newList.push(list);
        }
      }
      this.unitBuildList = newList;
    },
    clearUnitBuildList: function (type) {
      var newList = [];
      if (type) {
        for (var i = 0; i < this.unitBuildList.length; i++) {
          if (this.unitBuildList[i].type != type) {
            newList.push(this.unitBuildList[i]);
          }
        }
      }
      this.unitBuildList = newList;
    },
    getUnitBuildsByUnit: function () {
      var ret = {};
      for (var i = 0; i < this.unitBuildList.length; i++) {
        for (var uID in this.unitBuildList[i].units) {
          ret[uID] = ret[uID] || [];
          ret[uID].push({
            count: this.unitBuildList[i].units[uID],
            completionTime: this.unitBuildList[i].completionTime
          });
        }
      }
      return ret;
    },
    getUnitTransportsByUnit: function () {
      var ret = {};
      var data = database.getGlobalData.militaryMovements[this.getId];
      if (data) {
        for (var row in data) {
          for (var uID in data[row].troops) {
            ret[uID] = ret[uID] || [];
            ret[uID].push({
              count: data[row].troops[uID],
              arrivalTime: data[row].arrivalTime,
              origin: data[row].originCityId
            });
          }
        }
      }
      return ret;
    },
    get isCapital() {
      return this.getBuildingFromName(Constant.Buildings.PALACE) !== null;
    },
    get isColony() {
      return this.getBuildingFromName(Constant.Buildings.PALACE) === null;
    },
    get isUpgrading() {
      var res = false;
      $.each(this.getBuildings, function (idx, building) {
        res = res || building.isUpgrading;
      });
      return res;
    }
  };
  function GlobalData() {
    this._version = {
      lastUpdateCheck: 0,
      latestVersion: null,
      installedVersion: 0
    };
    this._research = {
      topics: {},
      lastUpdate: 0
    };
    this.governmentType = 'ikakratie';
    this.fleetMovements = [];
    this.militaryMovements = [];
    this.finance = {
      armyCost: 0,
      armySupply: 0,
      fleetCost: 0,
      fleetSupply: 0,
      currentGold: 0,
      sigmaExpenses: function () {
        return this.armyCost + this.armySupply + this.fleetCost + this.fleetSupply;
      },
      sigmaIncome: 0,
      lastUpdated: 0
    };
    this.localStrings = {};
    this.premium = {};
  }

  GlobalData.prototype = {
    init: function () {
      var lang = database.settings.languageChange.value;
      $.each(Constant.LanguageData[lang], this.addLocalisedString.bind(this));
      $.each(this.fleetMovements, function (key, movement) {
        this.fleetMovements[key] = new Movement(movement);
        this.fleetMovements[key]._updateTimer = null;
        this.fleetMovements[key].startUpdateTimer();
      }.bind(this));
    },
    hasPremiumFeature: function (feature) {
      return this.premium[feature] ? this.premium[feature].endTime > $.now() || this.premium[feature].continuous : false;
    },
    setPremiumFeature: function (feature, endTime, continuous) {
      var ret = !this.hasPremiumFeature(feature) && endTime > $.now();
      this.premium[feature] = { endTime: endTime, continuous: continuous };
      return ret;
    },
    getPremiumTimeRemaining: function (feature) {
      return this.premium[feature] ? this.premium[feature].endTime > $.now() : 0;
    },
    getPremiumTimeContinuous: function (feature) {
      return this.premium[feature] ? this.premium[feature].continuous : false;
    },
    removeFleetMovement: function (id) {
      var index = -1;
      $.each(this.fleetMovements, function (i, movement) {
        if (movement.getId == id) {
          this.fleetMovements.splice(i, 1);
          return false;
        }
      }.bind(this));
    },
    addFleetMovement: function (transport) {
      try {
        this.fleetMovements.push(transport);
        transport.startUpdateTimer();
        this.fleetMovements.sort(function (a, b) {
          return a.getArrivalTime - b.getArrivalTime;
        });
        var changes = [];

        $.each(transport.getResources, function (resourceName, value) {
          changes.push(resourceName);
        });
        return changes;
      } catch (e) {
        empire.error('addFleetMovement', e);
      }
    },
    getMovementById: function (id) {
      for (var i in this.fleetMovements) {
        if (this.fleetMovements[i].getId == id) {
          return this.fleetMovements[i];
        }
      }
      return false;
    },
    clearFleetMovements: function () {
      var changes = [];
      $.each(this.fleetMovements, function (index, item) {
        changes.push(item.getTargetCityId);
        item.clearUpdateTimer();
      });
      this.fleetMovements.length = 0;
      return $.exclusive(changes);
    },
    getResourceMovementsToCity: function (cityID) {
      return this.fleetMovements.filter(function (el) {
        if (el.getTargetCityId == cityID) {
          return (el.getMission == 'trade' || el.getMission == 'transport' || el.getMission == 'plunder');
        }
      });
    },
    getMilitaryMovementsToCity: function (cityID) {
      return this.fleetMovements.filter(function (el) {
        if (el.getOriginCityId == cityID) {
          return (el.getMission != 'trade' && el.getMission != 'transport' && el.getMission == 'plunder' && el.getMission == 'deploy');
        }
      });
    },
    getResearchTopicLevel: function (research) {
      return this._research.topics[research] || 0;
    },
    updateResearchTopic: function (topic, level) {
      var changed = this.getResearchTopicLevel(topic) != level;
      this._research.topics[topic] = level;
      return changed;
    },
    get getGovernmentType() {
      return this.governmentType;
    },
    getLocalisedString: function (string) {
      var lString;
      lString = this.localStrings[string.replace(/([A-Z])/g, "_$1").toLowerCase()];
      if (lString == undefined)
        lString = this.localStrings[string.toLowerCase().split(' ').join('_')];
      return (lString == undefined) ? string : lString;
    },
    addLocalisedString: function (string, value) {
      if (this.getLocalisedString(string) == string)
        this.localStrings[string.toLowerCase().split(' ').join('_')] = value;
    },
    isOldVersion: function () {
      return this._version.latestVersion < this._version.installedVersion;
    }
  };
  function Setting(name) {
    this._name = name;
    this._value = null;
  }
  Setting.prototype = {
    get name() {
      return database.getGlobalData.getLocalisedString(this._name);
    },
    get type() {
      return Constant.SettingData[this._name].type;
    },
    get description() {
      return database.getGlobalData.getLocalisedString(this._name + '_description');
    },
    get value() {
      return (this._value !== null ? this._value : Constant.SettingData[this._name].default);
    },
    get categories() {
      return Constant.SettingData[this._name].categories;
    },
    get choices() {
      return Constant.SettingData[this._name].choices || false;
    },
    get selection() {
      return Constant.SettingData[this._name].selection || false;
    },
    set value(value) {
      if (this.type === 'boolean') {
        this._value = !!value;
      }
      else if (this.type === 'number') {
        if (!isNaN(value)) {
          this._value = value;
        }
      }
      else if (this.type === 'buildings') {
        if (!isNaN(value)) {
          this._value = value;
        }
      }
      else if (this.type === 'language') {
        this._value = value;
      }
      else if (this.type === 'array' || this.type === 'orderedList') {
        if (Object.prototype.toString.call(value) === '[object Array]') {
          this._value = value;
        }
      }
    },
    toJSON: function () {
      return { value: this._value };
    }
  };
  /***********************************************************************************************************************
   * empire
   **********************************************************************************************************************/
  const EMPIRE_STORAGE_PREFIX = [
    '', GM_info.script.namespace, GM_info.script.name, unsafeWindow.dataSetForView.avatarId, ''].join('***');
  var empire = {
    version: 1.1909,
    scriptId: 456297,
    scriptName: 'Empire Overview',
    logger: null,
    loaded: false,
    setVar: function (varname, varvalue) {
      GM_setValue(EMPIRE_STORAGE_PREFIX + varname, varvalue);
    },
    deleteVar: function (varname) {
      GM_deleteValue(EMPIRE_STORAGE_PREFIX + varname);
    },
    getVar: function (varname, vardefault) {
      var ret = GM_getValue(EMPIRE_STORAGE_PREFIX + varname);
      if (null === ret && 'undefined' != typeof vardefault) {
        return vardefault;
      }
      return ret;
    },
    log: function (val) {
      if (debug) console.log('empire: ', $.makeArray(arguments));
      if (log) {
        if (this.logger) {
          this.logger.val(val + '\n' + this.logger.val());
          return true;
        } else {
          render.$tabs.append($(document.createElement("div")).attr('id', 'empire_Log'));
          $('#empire_Log').html('<div><textarea id="empire_Logbox" rows="20" cols="120"></textarea></div>');
          $('<li><a href="#empire_Log"><img class="ui-icon ui-icon-info"/></a></li>').appendTo("#empire_Tabs .ui-tabs-nav");
          render.$tabs.tabs('refresh');
          this.logger = $('#empire_Logbox');
          return this.log(val);
        }
      }
    },
    error: function (func, e) {
      this.log('****** Error raised in ' + func + ' ******');
      this.log(e.name + ' : ' + e.message);
      this.log(e.stack);
      this.log('****** End ******');
      if (debug) {
        console.error('****** Error raised in ' + func + ' ******');
        console.error(e.name + ' : ' + e.message);
        console.error(e.stack);
        console.error('****** End ******');
      }
    },
    time: function (func, name) {
      if (timing) console.time(name);
      var ret = func();
      if (timing) console.timeEnd(name);
      return ret;
    },
    Init: function () {
      ikariam.Init();
      render.Init();
      database.Init(ikariam.Host());
      this.CheckForUpdates(false);
      GM_registerMenuCommand(this.scriptName + 'Manual Update', function () {
        empire.CheckForUpdates(true);
      });

      initResourceProduction();

    },

    CheckForUpdates: function (forced) {
      var lang = database.settings.languageChange.value;
      if ((forced) || ((database.getGlobalData.LastUpdateCheck + 86400000 <= $.now()) && database.settings.autoUpdates.value)) {
        try {
          GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://greasyfork.org/scripts/' + empire.scriptId + '-empire-overview/code/Empire%20Overview.user.js', // + $.now(),
            headers: { 'Cache-Control': 'no-cache' },
            onload: function (resp) {
              var remote_version, rt;
              rt = resp.responseText;
              database.getGlobalData.LastUpdateCheck = $.now();
              remote_version = parseFloat(/@version\s*(.*?)\s*$/m.exec(rt)[1]);
              if (empire.version != -1) {
                if (remote_version > empire.version) {
                  if (confirm(Constant.LanguageData[lang].alert_update + empire.scriptName + '". \n' + Constant.LanguageData[lang].alert_update1)) {
                    // if(confirm(Utils.format(Constant.LanguageData[lang].alert_update,[empire.scriptName]))) {
                    GM_openInTab('https://greasyfork.org/scripts/' + empire.scriptId + '-empire-overview');
                  }
                } else if (forced)
                  render.toast(Constant.LanguageData[lang].alert_noUpdate + empire.scriptName + '".');
                // render.toast(Utils.format(Constant.LanguageData[lang].alert_noUpdate,[empire.scriptName]));
              }
              database.getGlobalData.latestVersion = remote_version;
            }
          });
        } catch (err) {
          if (forced)
            render.toast(Constant.LanguageData[lang].alert_error + '\n' + err);
        }
      }
    },

    HardReset: function () {
      var lang = database.settings.languageChange.value;
      database = {};
      empire.deleteVar("settings");
      empire.deleteVar("Options");
      empire.deleteVar("options");
      empire.deleteVar("cities");
      empire.deleteVar("LocalStrings");
      empire.deleteVar("globalData");
      render.toast(Constant.LanguageData[lang].alert_toast);
      setTimeout(function () {
        document.location = document.getElementById('js_cityLink').children[0].href;
      }, 3500);
    }
  };
  /***********************************************************************************************************************
   * database
   **********************************************************************************************************************/
  var database = {
    _globalData: new GlobalData(),
    cities: {},
    settings: {
      version: empire.version,
      window: {
        left: 110,
        top: 200,
        activeTab: 0,
        visible: true
      },
      addOptions: function (objVals) {
        return $.mergeValues(this, objVals);
      }
    },
    Init: function (host) {
      $.each(Constant.Settings, function (key, value) {
        this.settings[value] = new Setting(value);
      }.bind(database));
      var prefix = host;
      prefix = prefix.replace('.ikariam.', '-');
      prefix = prefix.replace('.', '-');
      this.Prefix = prefix;
      this.Load();
      events(Constant.Events.LOCAL_STRINGS_AVAILABLE).sub(ikariam.getLocalizationStrings.bind(this));
      $(window).on("beforeunload", function () {
        setTimeout(function () {
          database.Save();
        }, 0);
      });
    },
    addCity: function (id, a) {
      if (a) {
        return $.mergeValues(new City(id), a);
      } else return new City(id);
    },
    get getBuildingCounts() {
      var buildingCounts = {};
      $.each(this.cities, function (cityId, city) {
        $.each(Constant.Buildings, function (key, value) {
          if (database.settings.alternativeBuildingList.value && (value === '')) {
          } else if (database.settings.compressedBuildingList.value && (value == Constant.Buildings.STONEMASON || value == Constant.Buildings.WINERY || value == Constant.Buildings.ALCHEMISTS_TOWER || value == Constant.Buildings.GLASSBLOWER)) {
            buildingCounts.productionBuilding = Math.max(buildingCounts.productionBuilding || 0, city.getBuildingsFromName(value).length);
          } else if (database.settings.compressedBuildingList.value && (value == Constant.Buildings.GOVERNORS_RESIDENCE || value == Constant.Buildings.PALACE)) {
            buildingCounts.colonyBuilding = Math.max(buildingCounts.colonyBuilding || 0, city.getBuildingsFromName(value).length);
          } else {
            buildingCounts[value] = Math.max(buildingCounts[value] || 0, city.getBuildingsFromName(value).length);
          }
        });
      });
      return buildingCounts;
    },
    startMonitoringChanges: function () {
      events(Constant.Events.BUILDINGS_UPDATED).sub(this.Save.bind(this));
      events(Constant.Events.GLOBAL_UPDATED).sub(this.Save.bind(this));
      events(Constant.Events.MOVEMENTS_UPDATED).sub(this.Save.bind(this));
      events(Constant.Events.RESOURCES_UPDATED).sub(this.Save.bind(this));
      events(Constant.Events.MILITARY_UPDATED).sub(this.Save.bind(this));
      events(Constant.Events.PREMIUM_UPDATED).sub(this.Save.bind(this));
    },
    Load: function () {
      var settings = this.UnSerialize(empire.getVar("settings", ""));
      if (typeof settings === 'object') {
        if (!this.isDatabaseOutdated(settings.version)) {

          $.mergeValues(this.settings, settings);

          var globalData = this.UnSerialize(empire.getVar("globalData", ""));
          //---mrfix---
          var cases = ['demokratie', 'ikakratie', 'aristokratie', 'diktatur', 'nomokratie', 'oligarchie', 'technokratie', 'theokratie'];
          globalData.governmentType = cases.indexOf(globalData.governmentType) === -1 ? '' : globalData.governmentType;
          //---mrfix---
          if (globalData.governmentType === '') globalData.governmentType = 'ikakratie';
          if (typeof globalData == 'object') {
            $.mergeValues(this._globalData, globalData);

          }
          var cities = this.UnSerialize(empire.getVar("cities", ""));
          if (typeof cities == 'object') {
            for (var cityID in cities) {
              (this.cities[cityID] = this.addCity(cities[cityID]._id, cities[cityID])).init();
            }
          }
        }
        this._globalData.init();
      }
      events(Constant.Events.DATABASE_LOADED).pub();
    },
    Serialize: function (data) {
      var ret;
      if (data)
        try {
          ret = JSON.stringify(data);
        } catch (e) {
          empire.log('error saving');
        }
      return ret || undefined;
    },
    UnSerialize: function (data) {
      var ret;
      if (data)
        try {
          ret = JSON.parse(data);
        } catch (e) {
          empire.log('error loading');
        }
      return ret || undefined;
    },
    Save: function () {
      events.scheduleAction(function () {
        empire.setVar("cities", database.Serialize(database.cities));
        empire.setVar("settings", database.Serialize(database.settings));
        empire.setVar("globalData", database.Serialize(database._globalData));
      });

    },
    get getGlobalData() {
      return this._globalData;
    },
    isDatabaseOutdated: function (version) {
      return 1.166 > (version || 0);
    },
    getCityFromId: function (id) {
      return this.cities[id] || null;
    },
    get getArmyTotals() {
      if (!this._armyTotals) {
        this._armyTotals = Utils.cacheFunction(this._getArmyTotals.bind(database), 1000);
      }
      return this._armyTotals();
    },
    _getArmyTotals: function () {
      var totals = {};
      $.each(Constant.UnitData, function (unitId, info) {
        totals[unitId] = { training: 0, total: 0, incoming: 0, plunder: 0 };
      });
      $.each(this.cities, function (cityId, city) {
        var train = city.military.getTrainingTotals;
        var incoming = city.military.getIncomingTotals;
        var total = city.military.getUnits.totals;
        $.each(Constant.UnitData, function (unitId, info) {
          totals[unitId].training += train[unitId] || 0;
          totals[unitId].total += total[unitId] || 0;
          totals[unitId].incoming += incoming[unitId] || 0;
          // totals[unitId].plunder += plunder[unitId] || 0;
        });
      });
      return totals;
    },
    get getCityCount() {
      return Object.keys(this.cities).length;
    },
    _getArmyTrainingTotals: function () {
    }
  };
  /***********************************************************************************************************************
   * render view
   **********************************************************************************************************************/

  var render = {
    mainContentBox: null,
    $tabs: null,
    cityRows: {
      building: {},
      resource: {},
      army: {}
    },
    _cssResLoaded: false,
    // Add cached selectors
    _cachedSelectors: {
      $empireBoard: null,
      $empireTabs: null,
      $resTab: null,
      $buildTab: null,
      $armyTab: null,
      $settingsTab: null,
      $helpTab: null
    },

    // Add method to initialize cached selectors
    _initCachedSelectors: function() {
      this._cachedSelectors.$empireBoard = $('#empireBoard');
      this._cachedSelectors.$empireTabs = $('#empire_Tabs');
      this._cachedSelectors.$resTab = $('#ResTab');
      this._cachedSelectors.$buildTab = $('#BuildTab');
      this._cachedSelectors.$armyTab = $('#ArmyTab');
      this._cachedSelectors.$settingsTab = $('#SettingsTab');
      this._cachedSelectors.$helpTab = $('#HelpTab');
    },
    
    // Add method to get cached selector with lazy initialization
    _getCachedSelector: function(name) {
      if (!this._cachedSelectors[name] || this._cachedSelectors[name].length === 0) {
        // Re-initialize if selector is null or empty
        this._initCachedSelectors();
      }
      return this._cachedSelectors[name];
    },

    toolTip: {
      elem: null,
      timer: null,
      hide: function () {
        render.toolTip.elem.parent().hide();
      },
      show: function () {
        render.toolTip.elem.parent().show();
      },

      mouseOver: function (event) {
        if (render.toolTip.timer) {
          render.toolTip.timer();
        }
        var f = function (shiftKey) {
          return function () {
            var elem;
            elem = $(event.target).attr('data-tooltip') ? event.target : $(event.target).parents('[data-tooltip]');

            render.toolTip.elem.html(render.toolTip.dynamicTip($(event.target).parents('tr').attr('id') ? $(event.target).parents('tr').attr('id').split('_').pop() : 0, elem));
            return render.toolTip.elem.html();
          };
        }(event.originalEvent.shiftKey);
        if (f(event.originalEvent.shiftKey)) {
          render.toolTip.show();
          render.toolTip.timer = events.scheduleActionAtInterval(f, 1000);
        }
      },
      mouseMove: function (event) {
        if (render.toolTip.timer && render.toolTip.elem) {
          var l = parseInt(render.mainContentBox.css('left').split('px')[0]);
          var t = parseInt(render.mainContentBox.css('top').split('px')[0]);
          var x = event.pageX - 15 - l;
          var y = event.pageY + 20 - t;

          if (render.mainContentBox.height() - render.toolTip.elem.height() < y) {
            y = event.pageY - render.toolTip.elem.height() - 15 - t;
          }
          if (render.mainContentBox.width() - render.toolTip.elem.width() < x) {
            x = event.pageX - render.toolTip.elem.width() + 15 - l;
          }
          render.toolTip.elem.parent().css({
            left: (x) + 'px',
            top: (y) + 'px'
          });
        }
      },
      mouseOut: function (event) {
        if (render.toolTip.timer) {
          render.toolTip.timer();
          render.toolTip.timer = null;
        }
        render.toolTip.hide();
      },
      init: function () {
        render.toolTip.elem = render.mainContentBox.append($('<div id="empireTip" style="z-index: 999999999;"><div class="content"></div></div>')).find('div.content');
        render.mainContentBox.on('mouseover', '[data-tooltip]', render.toolTip.mouseOver).on('mousemove', '[data-tooltip]', render.toolTip.mouseMove).on('mouseout', '[data-tooltip]', render.toolTip.mouseOut);
      },

      dynamicTip: function (id, elem) {
        var lang = database.settings.languageChange.value;
        var $elem = $(elem);
        var tiptype;
        if ($elem.attr('data-tooltip') === "dynamic") {
          tiptype = $elem.attr('class').split(" ");
        } else {
          return $elem.attr('data-tooltip') || '';
        }
        var city = database.getCityFromId(id);
        var resourceName;
        if (city) {
          resourceName = $elem.is('td') ? $elem.attr('class').split(' ').pop() : $elem.parent('td').attr('class').split(' ').pop();
        }
        var total;
        switch (tiptype.shift()) {
          case "incoming":
            return getIncomingTip();
            break;
          case "current":
            return '';
            break;
          case "progressbar":
            if (resourceName !== Constant.Resources.GOLD)
              return getProgressTip();
            break;
          case "total":
            switch ($elem.attr('id').split('_').pop()) {
              case "sigma":
                return getResourceTotalTip();
                break;
              case "goldincome":
                return getGoldIncomeTip();
                break;
              case "research":
                var researchDat;
                $.each(database.cities, function (cityId, city) {
                  if (researchDat) {
                    $.each(city.research.researchData, function (key, value) {
                      researchDat[key] += value;
                    });
                  }
                  else researchDat = $.extend({}, city.research.researchData);
                });
                return getResearchTip(researchDat);
                break;
              case "army":
                return "soon";
                break;
              case "wineincome":
                total = 0;
                var consumption = 0;
                resourceName = $elem.attr('id').split('_').pop().split('income').shift();
                $.each(database.cities, function (cityId, c) {
                  total += c.getResource(resourceName).getProduction;
                  consumption += c.getResource(resourceName).getConsumption;
                });
                return getProductionConsumptionSubSumTip(total * 3600, consumption, true);
                break;
              default:
                total = 0;
                resourceName = $elem.attr('id').split('_').pop().split('income').shift();
                $.each(database.cities, function (cityId, c) {
                  total += c.getResource(resourceName).getProduction;
                });
                return getProductionTip(total * 3600);
                break;
            }
          case "pop":
            return getPopulationTip();
            break;
          case "happy":
            return getGrowthTip();
            break;
          case "garrisonlimit":
            return getActionPointsTip();
            break;
          case "wonder":
            return city.getBuildingFromName(Constant.Buildings.TEMPLE) ? getWonderTip() : getNoWonderTip();
            break;
          case "prodconssubsum consumption Red":
            return getFinanceTip();
            break;
          case "scientists":
            return getResearchTip();
            break;
          case "prodconssubsum":
            return resourceName === Constant.Resources.GOLD ? getFinanceTip() : getProductionConsumptionSubSumTip(city.getResource(resourceName).getProduction * 3600, city.getResource(resourceName).getConsumption);
            break;
          case "building":
            var bName = tiptype.shift();
            var index = parseInt(bName.slice(-1));
            bName = bName.slice(0, -1);
            return getBuildingTooltip(city.getBuildingsFromName(bName)[index]);
          case "army":
            switch (tiptype.shift()) {
              case "unit":
                return '';
                break;
              case "movement":
                return getArmyMovementTip(tiptype.pop());
                break;
              case "incoming":
                return getIncomeMovementTip(tiptype.pop());
                break;
              /*   case "plunder":
                   return getPlunderMovementTip(tiptype.pop());
                   break	*/
            }
            break;
          default:
            return "";
            break;
        }

        function getGoldIncomeTip() {
          var researchCost = 0;
          var income = 0;
          var sigmaIncome = 0;
          $.each(database.cities, function (cityID, city) {
            researchCost += Math.floor(city.getExpenses);
            income += Math.floor(city.getIncome);
          });
          var expense = database.getGlobalData.finance.armyCost + database.getGlobalData.finance.armySupply + database.getGlobalData.finance.fleetCost + database.getGlobalData.finance.fleetSupply - researchCost;
          sigmaIncome = income - expense;
          return '<table>\n    <thead>\n    <th><div align="center">\n <img src="/cdn/all/both/resources/icon_upkeep.png" style="height: 14px;"></td><td><b>1 ' + Constant.LanguageData[lang].hour + '</b></td><td><b>1 ' + Constant.LanguageData[lang].day + '</b></td><td><b> 1 ' + Constant.LanguageData[lang].week + '</b></div><td></td></th>\n    </thead>\n    <tbody>\n    <tr class="data">\n        <td><b>-&nbsp;</b></td>\n        <td> ' + Utils.FormatNumToStr(database.getGlobalData.finance.armyCost, false, 0) + ' </td>\n        <td> ' + Utils.FormatNumToStr(database.getGlobalData.finance.armyCost * 24, false, 0) + '</td>\n        <td> ' + Utils.FormatNumToStr(database.getGlobalData.finance.armyCost * 24 * 7, false, 0) + '</td>\n        <td class="left"><i>« ' + Constant.LanguageData[lang].army_cost + '</i></td>\n    </tr>\n    <tr class="data">\n        <td><b>-&nbsp;</b></td>\n        <td class="nolf"> ' + Utils.FormatNumToStr(database.getGlobalData.finance.fleetCost, false, 0) + '</td>\n        <td>' + Utils.FormatNumToStr(database.getGlobalData.finance.fleetCost * 24, false, 0) + '</td>\n        <td>' + Utils.FormatNumToStr(database.getGlobalData.finance.fleetCost * 24 * 7, false, 0) + '</td>\n        <td class="left"><i>« ' + Constant.LanguageData[lang].fleet_cost + '</i></td>\n    </tr>\n    <tr class="data">\n        <td><b>-&nbsp;</b></td>\n        <td class="nolf">' + Utils.FormatNumToStr(database.getGlobalData.finance.armySupply, false, 0) + '</td>\n        <td>' + Utils.FormatNumToStr(database.getGlobalData.finance.armySupply * 24, false, 0) + '</td>\n        <td>' + Utils.FormatNumToStr(database.getGlobalData.finance.armySupply * 24 * 7, false, 0) + '</td>\n        <td class="left"><i>« ' + Constant.LanguageData[lang].army_supply + '</i></td>\n    </tr>\n    <tr class="data">\n        <td><b>-&nbsp;</b></td>\n        <td class="nolf">' + Utils.FormatNumToStr(database.getGlobalData.finance.fleetSupply, false, 0) + '</td>\n        <td>' + Utils.FormatNumToStr(database.getGlobalData.finance.fleetSupply * 24, false, 0) + '</td>\n        <td>' + Utils.FormatNumToStr(database.getGlobalData.finance.fleetSupply * 24 * 7, false, 0) + '</td>\n        <td class="left"><i>« ' + Constant.LanguageData[lang].fleet_supply + '</i></td>\n    </tr>\n    <tr class="data">\n        <td><b>-&nbsp;</b></td>\n        <td class="nolf">' + Utils.FormatNumToStr(researchCost, false, 0) + '</td>\n        <td>' + Utils.FormatNumToStr(researchCost * 24, false, 0) + '</td>\n        <td>' + Utils.FormatNumToStr(researchCost * 24 * 7, false, 0) + '</td>\n        <td class="left"><i>« ' + Constant.LanguageData[lang].research_cost + '</i></td>\n    </tr>\n    <tr style="border-top:1px solid #FFE4B5">\n        <td><b>+&nbsp;</b></td>\n        <td class="nolf">' + Utils.FormatNumToStr(income, false, 0) + '</td>\n        <td>' + Utils.FormatNumToStr(income * 24, false, 0) + '</td>\n        <td>' + Utils.FormatNumToStr(income * 7 * 24, false, 0) + '</td>\n        <td class="left"><i>« ' + Constant.LanguageData[lang].income + '</i></td>\n    </tr>\n    <tr>\n        <td><b>-&nbsp;</b></td>\n        <td class="nolf">' + Utils.FormatNumToStr(expense, false, 0) + '</td>\n        <td class="left">' + Utils.FormatNumToStr(expense * 24, false, 0) + '</td>\n        <td>' + Utils.FormatNumToStr(expense * 24 * 7, false, 0) + '</td>\n        <td><i>« ' + Constant.LanguageData[lang].expenses + '</i></td></tbody><tfoot>\n    </tr>\n    <tr  class="total">\n        <td><b>Σ ' + ((sigmaIncome > 0) ? '+&nbsp;' : '-&nbsp;') + '</b></td>\n        <td>' + Utils.FormatNumToStr((sigmaIncome), false, 0) + '</td>\n        <td>' + Utils.FormatNumToStr((sigmaIncome) * 24, false, 0) + '</td>\n        <td>' + Utils.FormatNumToStr((sigmaIncome) * 7 * 24, false, 0) + '</td>\n        <td><i>« ' + Constant.LanguageData[lang].balances + '</i></td>\n    </tr>\n    </tfoot>\n</table>';
        }
        function getArmyMovementTip(unit) {
          var total = 0;
          var table = '<table>\n    <thead>\n        <th colspan="3"><div align="center"><img src="{0}" style="height: 18px; float: left"></td>\n        <b>' + Constant.LanguageData[lang].training + '</b></div></th>\n        \n    </thead>\n    <tbody>\n{1}\n    </tbody><tfoot><tr class="small">\n        <td><b>Σ +</b></td>\n        <td>{2}</td>\n        <td class="left"><i>« ' + Constant.LanguageData[lang].total_ + '</i></td>\n    </tr>\n    </tfoot>\n</table>';
          var rows = '';
          $.each(city.military.getTrainingForUnit(unit), function (index, data) {
            rows += Utils.format('<tr class="data">\n    <td><b>+</b></td>\n    <td >{0}</td>\n    <td ><i>« {1}</i></td>\n</tr>', [data.count, Utils.FormatTimeLengthToStr(data.time - $.now(), 3)]);
            total += data.count;
          });

          if (rows === '') {
            return '';
          } else {
            return Utils.format(table, [getImage(unit), rows, total]);
          }
        }
        function getPopulationTip() {
          var populationData = city.populationData;
          var popDiff = populationData.maxPop - populationData.currentPop;
          var Tip = '';
          if (popDiff !== 0) {
            Tip = '<tr class="data"><tfoot>&nbsp;' + Utils.FormatTimeLengthToStr((popDiff) / populationData.growth * 3600000, 4) + '<td> « ' + Constant.LanguageData[lang].time_to_full + '</td>\n    </tr>\n</tfoot>';
          }
          var populationTip = '<table>\n    <thead>\n    <th colspan="2"><div align="center">\n <img src="/cdn/all/both/resources/icon_population.png" style="height: 15px; float: left"><b>{0}</b></div></th>\n    </thead>\n    <tbody>\n ' +
            '<tr class="data">\n        <td>{1}</td>\n        <td>« {5}</td>\n    </tr>\n' +
            '<tr class="data">\n        <td>{2}</td>\n        <td>« {0}</td>\n    </tr>\n' +
            '<tr class="data">\n        <td>{3}</td>\n        <td>« {6}</td>\n    </tr>\n' +
            '<tr class="data">\n        <td>{4}</td>\n        <td>« {7}</td>\n    </tr></tbody>\n </table>{8}';
          return Utils.format(populationTip, [Constant.LanguageData[lang].citizens, Utils.FormatNumToStr(populationData.maxPop, false, 0), Utils.FormatNumToStr(populationData.currentPop, false, 0), Utils.FormatNumToStr(city._citizens, false, 0), ((popDiff === 0) ? Constant.LanguageData[lang].full : Utils.FormatNumToStr(popDiff, false, 2)), Constant.LanguageData[lang].housing_space, Constant.LanguageData[lang].free_housing_space, Constant.LanguageData[lang].free_Citizens, Tip]);
        }
        function getGrowthTip() {
          var lang = database.settings.languageChange.value;
          var populationData = city.populationData;
          var popDiff = populationData.maxPop - populationData.currentPop;
          var Icon = populationData.happiness >= 0 ? '/cdn/all/both/icons/growth_positive.png' : '/cdn/all/both/icons/growth_negative.png';
          var Tip = '';
          if (popDiff > 0) {
            Tip = '<table>\n    <thead>\n    <th><div align="center">\n <img src="' + Icon + '" style="height: 14px;"></td><td><b>1 ' + Constant.LanguageData[lang].hour + '</b></td><td><b>1 ' + Constant.LanguageData[lang].day + '</b></td><td><b> 1 ' + Constant.LanguageData[lang].week + '</b></div><td></td></th>\n    </thead>\n    <tbody>\n <tr><td><b>' + ((populationData.growth > 0) ? '+' : '-') + '</b></td><td>' + ((popDiff === 0) ? '0' + Constant.LanguageData[lang].decimalPoint + '00' : Utils.FormatNumToStr(populationData.growth, false, 2)) + '</td><td>' + ((popDiff === 0) ? '0' + Constant.LanguageData[lang].decimalPoint + '00' : (populationData.growth * 24 > popDiff) ? Utils.FormatNumToStr(popDiff, false, 2) : Utils.FormatNumToStr(populationData.growth * 24, false, 2)) + '</td><td><i>' + ((popDiff === 0) ? '0' + Constant.LanguageData[lang].decimalPoint + '00' : (populationData.growth * 24 * 7 > popDiff) ? Utils.FormatNumToStr(popDiff, false, 2) : Utils.FormatNumToStr(populationData.growth * 24 * 7, false, 2)) + '</i></td><td></td></tr></tbody></table>';
          }
          var corruption = '<td>' + city.CorruptionCity + '';
          if (city.CorruptionCity > 0) {
            corruption = '<td class="red">' + city.CorruptionCity + '';
          }
          var sat = '';
          var img = '';
          if (populationData.growth < -1) {
            img = 'outraged';
            sat = Constant.LanguageData[lang].angry;
          } else if (populationData.growth < 0) {
            img = 'sad';
            sat = Constant.LanguageData[lang].unhappy;
          } else if (populationData.growth < 1) {
            img = 'neutral';
            sat = Constant.LanguageData[lang].neutral;
          } else if (populationData.growth < 6) {
            img = 'happy';
            sat = Constant.LanguageData[lang].happy;
          } else {
            img = 'ecstatic';
            sat = Constant.LanguageData[lang].euphoric;
          }
          var growthTip = '<table>\n    <thead>\n    <th colspan="2"><div align="center">\n <img src="/cdn/all/both/smilies/' + img + '_x25.png" style="height: 18px; float: left"><b>{0}</b></div></th>\n    </thead>\n    <tbody>\n ' +
            '<tr class="data">\n        <td>{1}</td>\n        <td>« {2}</td>\n    </tr>\n' +
            '<tr class="data">\n            {3}</td>\n        <td>« {4}</td>\n    </tr>\n' +
            '<tr class="data">\n        <td>{5}</td>\n        <td>« {6}</td>\n    </tr>\n' +
            '<tr class="data">\n        <td>{7}</td>\n        <td>« {8}</td>\n    </tr></tbody>\n  </table> {9}';
          return Utils.format(growthTip, [Constant.LanguageData[lang].satisfaction, Utils.FormatNumToStr(populationData.happiness, true, 0), sat, corruption + '%', Constant.LanguageData[lang].corruption, Math.floor(city._culturalGoods) + '/' + Math.floor(city.maxculturalgood), Constant.LanguageData[lang].cultural, Math.floor(city.tavernlevel) + '/' + Math.floor(city.maxtavernlevel), Constant.LanguageData[lang].level_tavern, Tip]);
        }
        function getActionPointsTip() {
          var garrisonTip = '<table>\n    <thead>\n    <th colspan="3"><div align="center">\n <b>{0}</b></div></th>\n    </thead>\n    <tbody>\n ' +
            '<tr class="data">\n        <td>{1}</td>\n        <td>{2}</td>\n        <td>« {3}</td>\n    </tr>\n' +
            '<tr class="data">\n        <td>{4}</td>\n        <td>{5}</td>\n        <td>« {6}</td>\n    </tr>\n</tfoot></table>';
          return Utils.format(garrisonTip, [Constant.LanguageData[lang].garrision, '<img src="/cdn/all/both/advisors/military/bang_soldier.png" style="height: 15px;">', city.garrisonland, Constant.LanguageData[lang].Inland, '<img src="/cdn/all/both/advisors/military/bang_ship.png" style="height: 15px;">', city.garrisonsea, Constant.LanguageData[lang].Sea]);
        }
        function getWonderTip() {
          var populationData = city.populationData;
          var wonderTip = '<table>\n    <thead>\n    <th colspan="3"><div align="center">\n <img src="/cdn/all/both/wonder/w{0}.png" style="height: 25px; float: left">{1}</div></th>\n    </thead>\n    <tbody>\n ' +
            '<tr class="data">\n        <td>{2}</td>\n        <td>« {3}</td>\n    </tr>\n' +
            '<tr class="data">\n        <td>{4}%</td>\n       <td>« {5}</td>\n    </tr>\n' +
            '</tbody></table>';
          return Utils.format(wonderTip, [city.getWonder, 'Brunnen des<br>Poseidon', city._priests, 'Priester', Utils.FormatNumToStr(city._priests * 500 / populationData.maxPop, false, 2), 'Konvertierung', '100', 'Inselglaube', '8h', 'Cooldown']);
        }
        function getNoWonderTip() {
          var populationData = city.populationData;
          var size = 25;
          /*if (city.getWonder == 4 || 5)
          size = 30;*/
          var noWonderTip = '<table><thead><th colspan="3"><div align="center"><img src="/cdn/all/both/wonder/w{0}.png" style="height: {4}px; float: left">{1}</div></th></thead>\n    <tbody>\n ' +
            '<tr class="data">\n        <td>{2}</td>\n        <td> {3}</td>\n    </tr>\n' +
            '</tbody></table>';
          return Utils.format(noWonderTip, [city.getWonder, 'Brunnen des<br>Poseidon', 'kein Tempel in', city._name, size]);
        }
        function getFinanceTip() {
          var totCity = Math.floor(city.getIncome + city.getExpenses);
          var Tip = '';
          if (city.getExpenses < 0) {
            Tip = '<td></td><td>' + Utils.FormatNumToStr(city.getExpenses, true, 0) + '</td><td>' + Utils.FormatNumToStr(city.getExpenses * 24, true, 0) + '</td><td><i>' + Utils.FormatNumToStr(city.getExpenses * 24 * 7, true, 0) + '</i></td><td></td></tr></tbody><tfoot><tr><td>\u03A3<b> ' + ((totCity > 0) ? '+&nbsp;' : '-&nbsp;') + '</b></td><td>' + Utils.FormatNumToStr(totCity, false, 0) + '</td><td>' + Utils.FormatNumToStr(totCity * 24, false, 0) + '</td><td><i>' + Utils.FormatNumToStr(totCity * 7 * 24, false, 0) + '</i></td><td></td></tr></tfoot>';
          }
          var financeTip = '<table>\n    <thead>\n    <th><div align="center">\n <img src="/cdn/all/both/resources/icon_upkeep.png" style="height: 14px;"></td><td><b>{0}</b></td><td><b>{1}</b></td><td><b>{2}</b></div><td></td></th>\n    </thead>\n    <tbody>\n ' +
            '<tr class="data">\n        <td></td>\n        <td>{3}</td>\n        <td>{4}</td>\n        <td><i>{5}</i></td>\n        <td></td>\n    </tbody></tr>\n{6}</table>';
          return Utils.format(financeTip, ['1 ' + Constant.LanguageData[lang].hour, '1 ' + Constant.LanguageData[lang].day, '1 ' + Constant.LanguageData[lang].week, Utils.FormatNumToStr(city.getIncome, true, 0), Utils.FormatNumToStr(city.getIncome * 24, false, 0), Utils.FormatNumToStr(city.getIncome * 24 * 7, false, 0), Tip]);
        }
        function getResearchTip(researchData) {
          researchData = researchData || city.research.researchData;
          var tooltip = (researchData.scientists > 0) ? '<table>\n    <thead>\n  <th colspan="5"><div align="center">\n <img src="/cdn/all/both/buildings/y50/y50_academy.png" style="height: 20px; float: left"><b>{0}</b></div></th>\n    </thead>\n    <tbody>\n ' +
            '<tr class="data">\n        <td>{1}</td>\n        <td colspan="4">« {2}</td>\n    </tr>\n' +
            '<tr class="data">\n        <td>{3}</td>\n        <td colspan="4">« {4}</td>\n    </tr>\n' +
            '<thead>\n    <th><div align="center">\n <img src="/cdn/all/both/resources/icon_research_time.png" style="height: 14px;">  <td><b>{5}</b></td><td><b>{6}</b></td><td><b>{7}</b></div><td></td></th>\n    </thead>\n    <tbody>\n  ' +
            '<tr class="data">\n        <td>{11}</td>\n        <td>{8}</td>\n        <td>{9}</td>\n    <td><i>{10}</i></td>\n        <td></td></tr>\n</table>' : '';
          return Utils.format(tooltip, [Constant.LanguageData[lang].academy, Utils.FormatNumToStr(researchData.scientists, false, 0), Constant.LanguageData[lang].scientists, Utils.FormatNumToStr(city.maxSci, false, 0), Constant.LanguageData[lang].scientists_max, '1 ' + Constant.LanguageData[lang].hour, '1 ' + Constant.LanguageData[lang].day, '1 ' + Constant.LanguageData[lang].week, Utils.FormatNumToStr(researchData.total, true, 0), Utils.FormatNumToStr(researchData.total * 24, false, 0), Utils.FormatNumToStr((researchData.total * 24) * 7, false, 0), database.getGlobalData.hasPremiumFeature(Constant.Premium.RESEARCH_POINTS_BONUS) ? '<img src="/cdn/all/both/premium/b_premium_research.jpg" style="width:18px;">' : '']);
        }
        function getIncomingTip() {
          var cRes = city.getResource(resourceName).getCurrent;
          if (resourceName === Constant.Resources.GOLD)
            cRes = database.getGlobalData.finance.currentGold;
          var rMov = database.getGlobalData.getResourceMovementsToCity(city.getId);
          var test = ''; //ToDo
          test = $('#js_MilitaryMovementsEventRow1546373TargetLink');
          var table = '<table>\n    <thead>{0}</thead>\n    <tbody>{1}</tbody>\n    <tfoot>{2}</tfoot>\n</table>';
          var row = '<tr class="data" style="border-top:1px solid #FFE4B5">\n    <td><div class="icon2 {0}Image"></div></td>\n    <td>{1}</td>\n    <td><i>« {2}</i></td>\n    \n</tr><td></td><td>{3}</td>\n<td class="small data">« ({4})</td>\n</tr><td colspan="2"><b>{5}</b></td><td>« ' + Constant.LanguageData[lang].arrival + '</td></tr>';
          var header = '<tr>\n    <th ><div class="icon2 merchantImage"></div></th>\n    <th colspan="3">' + Constant.LanguageData[lang].transport + '</th>\n</tr>';
          var subtotal = '<tr class="total" style="border-top:1px solid #FFE4B5">\n    <td>=</td>\n    <td>{0}</td>\n    <td colspan=2><i>{1}</i></td>\n</tr>';
          var footer = '<tr class="total">\n    <td>Σ</td>\n    <td>{0}</td><td></td>\n</tr>';
          if (rMov.length) {
            var trades = '';
            var transp = '';
            var plunder = '';
            var movTotal = 0;
            for (var movID in rMov) {
              if (!$.isNumeric(movID)) {
                break;
              }
              if (rMov[movID].getResources[resourceName]) {
                var origin = database.getCityFromId(rMov[movID].getOriginCityId);
                var tMov = Utils.format(row, [rMov[movID].getMission, Utils.FormatNumToStr(rMov[movID].getResources[resourceName], false, 0), origin ? origin.getName : rMov[movID].getOriginCityId, Utils.FormatRemainingTime(rMov[movID].getArrivalTime - $.now()), rMov[movID].isLoading ? Constant.LanguageData[lang].loading + ': ' + Utils.FormatRemainingTime(rMov[movID].getLoadingTime, false) : rMov[movID].getArrivalTime > $.now() ? Constant.LanguageData[lang].en_route : Constant.LanguageData[lang].arrived, Utils.FormatTimeToDateString(rMov[movID].getArrivalTime)]);
                if (rMov[movID].getMission == "trade")
                  trades += tMov; else if (rMov[movID].getMission == 'transport')
                  transp += tMov; else if (rMov[movID].getMission == 'plunder')
                  plunder += tMov;
                movTotal += rMov[movID].getResources[resourceName];
              }
            }
            if (trades === '' && transp === '' && plunder === '') {
              return '';
            }
            var body = trades + transp + plunder + Utils.format(subtotal, [
              Utils.FormatNumToStr(movTotal, false, 0), '« ' + Constant.LanguageData[lang].total_ + ''
            ]);
            var foot = Utils.format(footer, [
              Utils.FormatNumToStr((movTotal + cRes), false, 0)
            ]);
            var head = Utils.format(header, []);
            return Utils.format(table, [head, body, foot]);
          }
          return '';
        }
        // Tooltip presented when hovering over a building in buildings view
        function getBuildingTooltip(building) {
          var uConst = building.isUpgrading;
          var resourceCost = building.getUpgradeCost;
          var serverTyp = 1;
          if (ikariam.Server() == 's201' || ikariam.Server() == 's202') serverTyp = 3;
          var elem = '';
          var time = 0;
          var elemSum = 0;
          var elemSumNeed = 0;
          var needlevel = 0;
          var costlevel = 0;
          needlevel = building.getLevel + 2;
          costlevel = building.getLevel + 1;

          for (var key in resourceCost) {
            if (key == 'time') {
              time = '<tr class="total"><td><img src="/cdn/all/both/resources/icon_time.png" style="height: 11px; float: left;"></td><td colspan="2" ><i>(' + Utils.FormatTimeLengthToStr(resourceCost[key] / serverTyp, 3, ' ') + ')</i></td></tr>';
              continue;
            }
            if (resourceCost[key]) {
              elem += '<tr class="data"><td><div class="icon ' + key + 'Image"></div></td><td>' + Utils.FormatNumToStr(resourceCost[key], false, 0) + '</td>';
              elemSum += resourceCost[key];
              // elem += (building.city().getResource(key).getCurrent < resourceCost[key] ? '<td class="red left">(' + Utils.FormatNumToStr(building.city().getResource(key).getCurrent - resourceCost[key], true, 0) + ')</td></tr>' : '<td><img src="/cdn/all/both/interface/check_mark_17px.png" style="height:11px; float:left;"></td></tr>');
              var elemDiff = building.city().getResource(key).getCurrent - resourceCost[key];
              if (elemDiff < 0) {
                elem += '<td class="red left">(' + Utils.FormatNumToStr(elemDiff, true, 0) + ')</td></tr>';
                elemSumNeed += elemDiff;
              } else {
                elem += '<td><img src="/cdn/all/both/interface/check_mark_17px.png" style="height:11px; float:left;"></td></tr>';
              }
            }
          }
          // Summarized ressources and diff
          var elemSumStyle = '<tr class="total"><td style="height: 11px; float: left;">Σ: </td><td>' + Utils.FormatNumToStr(elemSum, false, 0) + '</td>' + (elemSumNeed < 0 ? '<td class="red left">(' + Utils.FormatNumToStr(elemSumNeed, true, 0) + ')</td>' : '<td><img src="/cdn/all/both/interface/check_mark_17px.png" style="height:11px; float:left;"></td>') + '</tr>';
          // Header and footer for howering over building
          elem = (elem !== '') ? '<table><thead><tr><th colspan="3" align="center"><b>' + (uConst ? Constant.LanguageData[lang].next_Level + ' ' + needlevel : Constant.LanguageData[lang].next_Level + ' ' + costlevel) + '</b></th></tr></thead><tbody>' + elem + '</tbody><tfoot>' + elemSumStyle + time + '</tfoot></table>' : '<table><thead><tr><th colspan="3" align="center">' + Constant.LanguageData[lang].max_Level + '</th></tr></thead></table>';
          if (uConst) {
            elem = '<table><thead><tr><th colspan="3" align="center"><b>' + Constant.LanguageData[lang].constructing + '</b></th></tr></thead>' + '<tbody><tr><td></td><td>' + Utils.FormatFullTimeToDateString(building.getCompletionTime, true) + '</td></tr>' + '<tr><td><img src="/cdn/all/both/resources/icon_time.png" style="height: 11px; float: left;"></td><td><i>(' + Utils.FormatTimeLengthToStr(building.getCompletionTime - $.now(), 3, ' ') + ')</i></td></tr></tbody></table>' + elem;
          }
          return elem;
        }
        function getResourceTotalTip() {
          var totals = {};
          var res;
          $.each(database.cities, function (cityId, city) {
            $.each(Constant.Resources, function (key, resourceName) {
              res = city.getResource(resourceName);
              if (!totals[resourceName]) {
                totals[resourceName] = {};
              }
              totals[resourceName].total = totals[resourceName].total ? totals[resourceName].total + res.getCurrent : res.getCurrent;
              totals[resourceName].income = totals[resourceName].income ? totals[resourceName].income + res.getProduction * 3600 - res.getConsumption : res.getProduction * 3600 - res.getConsumption;
              if (resourceName === Constant.Resources.GOLD) {
                var researchCost = 0, expense = 0, inGold = 3;
                res = 0;
                res += Math.floor(city.getIncome + city.getExpenses);
                researchCost += Math.floor(city.getExpenses);
                expense = (database.getGlobalData.finance.armyCost + database.getGlobalData.finance.armySupply + database.getGlobalData.finance.fleetCost + database.getGlobalData.finance.fleetSupply) / database.getCityCount;
                inGold = database.getGlobalData.finance.currentGold / database.getCityCount;
                totals[resourceName].total = totals[resourceName].total ? totals[resourceName].total + inGold : inGold;
                totals[resourceName].income = totals[resourceName].income ? totals[resourceName].income + res - expense : res - expense;
              }
            });
          });
          var r = '';
          var finalSums = { income: 0, total: 0, day: 0, week: 0 };
          $.each(totals, function (resourceName, data) {
            var day = data.total + data.income * 24;
            var week = data.total + data.income * 168;
            r += Utils.format('<tr class="data">\n    <td><div class="icon {0}Image"></div></td>\n    <td>{1}</td>\n    <td>{2}</td>\n    <td>{3}</td>\n    <td><i>{4}</i></td>\n<td></td></tr>', [resourceName, Utils.FormatNumToStr(data.income, true, 0), Utils.FormatNumToStr(data.total, true, 0), Utils.FormatNumToStr(day, true, 0), Utils.FormatNumToStr(week, true, 0)]);
            finalSums.income += data.income;
            finalSums.total += data.total;
            finalSums.day += day;
            finalSums.week += week;
          });
          if (r === '') {
            return '';
          } else {
            return Utils.format('<table>\n    <thead>\n    <td></td>\n    <td><b>1 {5}</b></td>\n    <td><b>{6}</b></td>\n    <td><b>+24 {7}</b></td>\n    <td><b> +1 {8}</b></td>\n  <td></td>  </thead>\n    <tbody>\n    {0}\n    <tfoot>\n    <td><b>\u03A3&nbsp;</b></td>\n    <td>{1}</td>\n    <td>{2}</td>\n    <td>{3}</td>\n    <td><i>{4}</i></td>\n  <td></td>  </tfoot>\n    </tbody>\n</td></table>', [r, Utils.FormatNumToStr(finalSums.income, true, 0), Utils.FormatNumToStr(finalSums.total, true, 0), Utils.FormatNumToStr(finalSums.day, true, 0), Utils.FormatNumToStr(finalSums.week, true, 0), Constant.LanguageData[lang].hour, Constant.LanguageData[lang].total_, Constant.LanguageData[lang].hour, Constant.LanguageData[lang].week]);
          }
        }
        function getProgressTip() {
          if (resourceName == 'population' || resourceName == 'ui-corner-all') { return ''; }
          var storage = city.maxResourceCapacities;
          var current = city.getResource(resourceName).getCurrent;
          var fulltime = (city.getResource(resourceName).getFullTime || 0 - city.getResource(resourceName).getEmptyTime) * 3600000;
          var gold = '';
          var serverTyp = 1;
          if (ikariam.Server() == 's201' || ikariam.Server() == 's202') serverTyp = 3;
          if (city.plundergold > 0 && serverTyp != 1) {
            gold = '<td><img src="/cdn/all/both/resources/icon_gold.png" style="height: 12px;"></td><td>' + Utils.FormatNumToStr(city.plundergold) + '</td><td>\u221E</td><td> « ' + Constant.LanguageData[lang].plundergold + '';
          }
          var progTip = '<table>\n <thead>\n <tr>\n <th><img src="/cdn/all/both/premium/safecapacity_small.png" style="height: 16px;"></th>\n <th><b>{12}</b></th>\n <th colspan="2"><b>{13}</b></th>\n        \n    </tr>\n    </thead>\n    <tbody>{0}{11}<tr class="total" style="border-top:1px solid #daa520">\n        <td>{9}</td>\n        <td>{1}</td>\n        <td>{2}</td>\n        <td><i>« {14}</i></td>\n    </tr>\n    <tr class="total">\n        <td></td>\n        <td>{16}</td>\n        <td>{17}</td>\n        <td><i>« {18}</i></td>\n    </tr>\n    <tr>\n        <td></td>\n        <td>{19}</td>\n        <td>{20}</td>\n        <td></td>\n    </tr>\n        <tr class="total" style="border-top:1px solid #daa520">\n        <td>{10}</td>\n        <td>{3}</td>\n        <td>{4}</td>\n        <td><i>« {15}</i></td>\n    </tr>\n    <tr>\n        <td></td>\n        <td>{5}</td>\n        <td>{6}</td>\n        <td></td>\n    </tr>\n    </tbody>\n    <tfoot>\n    <tr>\n        <td colspan="3">{7}</td>\n        <td>« {8}</td>\n    </tr>\n    </tfoot>\n</table>';
          var progTr = '<tr class="data">\n <td style="width:20px; background: url(\'{0}\'); background-size: auto 23px; background-position: -1px -1px; \n background-repeat: no-repeat;">\n </td>\n <td>{1}</td>\n <td>{2}</td>\n <td>« {3}</td>\n</tr>';
          var rows = '';
          $.each(storage.buildings, function (buildingName, data) {
            rows += Utils.format(progTr, [Constant.BuildingData[buildingName].icon, Utils.FormatNumToStr(data.safe, false, 0), Utils.FormatNumToStr(data.storage, false, 0), data.lang]);
          });
          return Utils.format(progTip, [rows, Utils.FormatNumToStr(storage.safe, false, 0), Utils.FormatNumToStr(storage.capacity, false, 0), Utils.FormatNumToStr(Math.min(storage.safe, current), false, 0), Utils.FormatNumToStr(Math.min(storage.capacity, current), false, 0), Utils.FormatNumToStr(Math.min(1, current / storage.safe) * 100, false, 2) + '%', Utils.FormatNumToStr(Math.min(1, current / storage.capacity) * 100, false, 2) + '%', Utils.FormatTimeLengthToStr(fulltime, 4), fulltime < 0 ? Constant.LanguageData[lang].time_to_empty : Constant.LanguageData[lang].time_to_full, database.getGlobalData.hasPremiumFeature(Constant.Premium.STORAGECAPACITY_BONUS) ? '<img src="/cdn/all/both/premium/b_premium_storagecapacity.jpg" style="width:18px;">' : '', database.getGlobalData.hasPremiumFeature(Constant.Premium.SAFECAPACITY_BONUS) ? '<img src="/cdn/all/both/premium/b_premium_safecapacity.jpg" style="width:18px;">' : '', gold, Constant.LanguageData[lang].safe, Constant.LanguageData[lang].capacity, Constant.LanguageData[lang].maximum, Constant.LanguageData[lang].used, Utils.FormatNumToStr(storage.safe - Math.min(storage.safe, current), false, 0), Utils.FormatNumToStr(storage.capacity - Math.min(storage.capacity, current), false, 0), Constant.LanguageData[lang].missing, Utils.FormatNumToStr(100 - (Math.min(1, current / storage.safe) * 100), false, 2 === 0) ? Utils.FormatNumToStr(100.01 - (Math.min(1, current / storage.safe) * 100), false, 2) + '%' : Utils.FormatNumToStr(100 - (Math.min(1, current / storage.safe) * 100), false, 2) + '%', Utils.FormatNumToStr(100 - (Math.min(1, current / storage.capacity) * 100), false, 2 === 0) ? Utils.FormatNumToStr(100.01 - (Math.min(1, current / storage.capacity) * 100), false, 2) + '%' : Utils.FormatNumToStr(100 - (Math.min(1, current / storage.capacity) * 100), false, 2) + '%']);
        }
        function getConsumptionTooltip(consumption, force) {
          if ((consumption === 0 && !force) || resourceName !== Constant.Resources.WINE) {
            return '';
          } else return Utils.format('<table>\n    <thead>\n    <th><div align="center">\n <img src="/cdn/all/both/resources/icon_{0}.png" style="height: 14px;">  <td><b>{1}</b></td><td><b>{2}</b></td><td><b>{3}</b></div><td></td></th>\n    </thead>\n    <tbody>\n  ' +
            '<tr class="data">\n            <td></td>\n            <td>{4}</td>\n            <td>{5}</td>\n            <td><i>{6}</i></td>\n        <td></td></tr>\n    </tbody>\n</table>',
            [Constant.Resources.WINE, '1 ' + Constant.LanguageData[lang].hour, '1 ' + Constant.LanguageData[lang].day, '1 ' + Constant.LanguageData[lang].week, Utils.FormatNumToStr(-consumption, true, 0), Utils.FormatNumToStr(-consumption * 24, true, 0), Utils.FormatNumToStr(-consumption * 24 * 7, true, 0)]);
        }
        function getProductionTip(income, force) {
          var resName = resourceName;
          if (resourceName == 'glass')
            resName = 'crystal';
          var resBonus = resourceName;
          if (resourceName == 'wood')
            resBonus = database.getGlobalData.hasPremiumFeature(Constant.Premium.WOOD_BONUS);
          if (resourceName == 'wine')
            resBonus = database.getGlobalData.hasPremiumFeature(Constant.Premium.WINE_BONUS);
          if (resourceName == 'marble')
            resBonus = database.getGlobalData.hasPremiumFeature(Constant.Premium.MARBLE_BONUS);
          if (resourceName == 'sulfur')
            resBonus = database.getGlobalData.hasPremiumFeature(Constant.Premium.SULFUR_BONUS);
          if (resourceName == 'glass')
            resBonus = database.getGlobalData.hasPremiumFeature(Constant.Premium.CRYSTAL_BONUS);
          if (income === 0 && !force) {
            return '';
          } else return Utils.format('<table>\n    <thead>\n    <th><div align="center">\n <img src="/cdn/all/both/resources/icon_{0}.png" style="height: 14px;">  <td><b>{1}</b></td><td><b>{2}</b></td><td><b>{3}</b></div><td></td></th>\n    </thead>\n    <tbody>\n  ' +
            '<tr class="data">\n        <td>{7}</td>\n        <td>{4}</td>\n        <td>{5}</td>\n        <td><i>{6}</i></td>\n    <td></td></tr>\n    </tbody>\n</table>',
            [resourceName, '1 ' + Constant.LanguageData[lang].hour, '1 ' + Constant.LanguageData[lang].day, '1 ' + Constant.LanguageData[lang].week, Utils.FormatNumToStr(income, true, 0), Utils.FormatNumToStr(income * 24, false, 0), Utils.FormatNumToStr(income * 24 * 7, false, 0), resBonus ? '<img src="/cdn/all/both/premium/b_premium_' + resName + '.jpg" style="width:18px;">' : '']);
        }
        function getProductionConsumptionSubSumTip(income, consumption, force) {
          if (income === 0 && consumption === 0 && !force) {
            return '';
          } else if (resourceName !== Constant.Resources.WINE) {
            return getProductionTip(income, force);
          } else if (income === 0) {
            return getConsumptionTooltip(consumption, force);
          } else return Utils.format('<table>\n    <thead>\n    <th><div align="center">\n <img src="/cdn/all/both/resources/icon_{0}.png" style="height: 14px;">  <td><b>{1}</b></td><td><b>{2}</b></td><td><b>{3}</b></div><td></td></th>\n    </thead>\n    <tbody>\n  ' +
            '<tr class="data">\n            <td>{14}</td>\n        <td>{4}</td>\n            <td>{5}</td>\n            <td><i>{6}</i></td>\n        <td></td></tr>\n    ' +
            '<tr class="data">\n            <td></td>\n            <td>{7}</td>\n            <td>{8}</td>\n            <td><i>{9}</i></td>\n        <td></td></tr>\n    </tbody><tfoot> ' +
            '<tr class="total">\n           <td>{10}</td>\n        <td>{11}</td>\n           <td>{12}</td>\n           <td><i>{13}</i></td>\n       <td></td></tr>\n    </tfoot>\n</table>',
            [resourceName, '1 ' + Constant.LanguageData[lang].hour, '1 ' + Constant.LanguageData[lang].day, '1 ' + Constant.LanguageData[lang].week, Utils.FormatNumToStr(income, true, 0), Utils.FormatNumToStr(income * 24, false, 0), Utils.FormatNumToStr(income * 24 * 7, false, 0), Utils.FormatNumToStr(-consumption, true, 0), Utils.FormatNumToStr(-consumption * 24, true, 0), Utils.FormatNumToStr(-consumption * 24 * 7, true, 0), (income > consumption ? '\u03A3 +&nbsp;' : '\u03A3 -&nbsp;'), Utils.FormatNumToStr((income - consumption), false, 0), Utils.FormatNumToStr((income - consumption) * 24, false, 0), Utils.FormatNumToStr((income - consumption) * 24 * 7, false, 0), database.getGlobalData.hasPremiumFeature(Constant.Premium.WINE_BONUS) ? '<img src="/cdn/all/both/premium/b_premium_wine.jpg" style="width:18px;">' : '']);
        }
        function getImage(unitID) {
          return (Constant.UnitData[unitID].type == 'fleet') ? '/cdn/all/both/characters/fleet/60x60/' + unitID + '_faceright.png' : '/cdn/all/both/characters/military/x60_y60/y60_' + unitID + '_faceright.png';
        }
      }
    },
    cssResLoaded: function () {
      var ret = this._cssResLoaded;
      this._cssResLoaded = true;
      return ret;
    },
    Init: function () {
      this.SidePanelButton();
      events(Constant.Events.DATABASE_LOADED).sub(function () {
        this.LoadCSS();
        this.DrawContentBox();
      }.bind(render));
      events(Constant.Events.MODEL_AVAILABLE).sub(function () {
        this.DrawTables();
        this.setCommonData();
        this.RestoreDisplayOptions();
        this.startMonitoringChanges();
        this.cityChange(ikariam.CurrentCityId);
      }.bind(render));
    },
    startMonitoringChanges: function () {
      events(Constant.Events.TAB_CHANGED).sub(function (tab) {
        this.stopResourceCounters();
        switch (tab) {
          case 0:
            this.startResourceCounters();
            break;
          case 1:
            this.updateCitiesBuildingData();
            break;
          case 2:
            this.updateCitiesArmyData();
            break;
          case 3:
            this.redrawSettings();
            break;
        }
      }.bind(render));
      events(Constant.Events.TAB_CHANGED).pub(database.settings.window.activeTab);
      events('cityChanged').sub(this.cityChange.bind(render));
      events(Constant.Events.BUILDINGS_UPDATED).sub(this.updateChangesForCityBuilding.bind(render));
      events(Constant.Events.GLOBAL_UPDATED).sub(this.updateGlobalData.bind(render));
      events(Constant.Events.MOVEMENTS_UPDATED).sub(this.updateMovementsForCity.bind(render));
      events(Constant.Events.RESOURCES_UPDATED).sub(this.updateResourcesForCity.bind(render));
      events(Constant.Events.CITY_UPDATED).sub(this.updateCityDataForCity.bind(render));
      events(Constant.Events.MILITARY_UPDATED).sub(this.updateChangesForCityMilitary.bind(render));
      events(Constant.Events.PREMIUM_UPDATED).sub(this.updateGlobalData.bind(render));
    },
    cityChange: function (cid) {
      var city = database.getCityFromId(cid);
      $('#empireBoard tr.current,#empireBoard tr.selected').removeClass('selected current');
      if (city) {
        this.getAllRowsForCity(city).addClass('selected').addClass((isChrome) ? 'current' : 'selected');
      }
    },
    getWorldmapTable: function () {
    },
    getHelpTable: function () {
      var lang = database.settings.languageChange.value;
      var elems = '<div id="HelpTab"><div>';
      var features = '<div class="options"><span class="categories">' + Constant.LanguageData[lang].Re_Order_Towns + '</span> ' + Constant.LanguageData[lang].On_any_tab + ''
        + '<hr>'
        + '<span class="categories">' + Constant.LanguageData[lang].Reset_Position + '</span> ' + Constant.LanguageData[lang].Right_click + ''
        + '<hr>'
        + '<span class="categories">' + Constant.LanguageData[lang].Hotkeys + '</span>'
        + '' + Constant.LanguageData[lang].Navigate + '<br>'
        + '' + Constant.LanguageData[lang].Navigate_to_City + '<br>'
        + '' + Constant.LanguageData[lang].Navigate_to + '<br>'
        + '' + Constant.LanguageData[lang].Navigate_to_World + '<br>'
        + '' + Constant.LanguageData[lang].Spacebar + ''
        + '<hr>'
        + '<span class="categories">' + Constant.LanguageData[lang].Initialize_Board + '</span>'
        + ' 1. <span id="helpTownhall" class="clickable"><b>> ' + Constant.LanguageData[lang].click_ + ' <</b></span> ' + Constant.LanguageData[lang].on_your_Town_Hall + '<br>'
        + ' 2. <span id="helpResearch" class="clickable"><b>> ' + Constant.LanguageData[lang].click_ + ' <</b></span> ' + Constant.LanguageData[lang].on_Research_Advisor + '<br>'
        + ' 3. <span id="helpPalace" class="clickable"><b>> ' + Constant.LanguageData[lang].click_ + ' <</b></span> ' + Constant.LanguageData[lang].on_your_Palace + '<br>'
        + ' 4. <span id="helpFinance" class="clickable"><b>> ' + Constant.LanguageData[lang].click_ + ' <</b></span> ' + Constant.LanguageData[lang].on_your_Finance + '<br>'
        //+ ' 5. <span id="helpShop" class="clickable"><b>> '+ Constant.LanguageData[lang].click_ +' <</b></span> '+ Constant.LanguageData[lang].on_the_Ambrosia +'<br>'
        + ' 5. <span id="helpMilitary" class="clickable"><b>> ' + Constant.LanguageData[lang].click_ + ' <</b></span> ' + Constant.LanguageData[lang].on_the_Troops + ''
        + '</div>';
      elems += features + '<div style="clear:left"></div>';
      elems += '</div></div>';
      return elems;
    },
    getSettingsTable: function () {
      var lang = database.settings.languageChange.value;
      var wineOut = '';
      var server = ikariam.Nationality();
      if (server == 'de') {
        wineOut = ' <span><input type="checkbox" id="empire_wineOut" ' + (database.settings.wineOut.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].wineOut_description + '"> ' + Constant.LanguageData[lang].wineOut + '</nobr></span>';
      }
      var piracy = '';
      if (database.getGlobalData.getResearchTopicLevel(Constant.Research.Seafaring.PIRACY)) {
        piracy = ' <span><input type="checkbox" id="empire_noPiracy" ' + (database.settings.noPiracy.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].noPiracy_description + '"> ' + Constant.LanguageData[lang].noPiracy + '</nobr></span>';
      }
      var elems = '<div id="SettingsTab"><div>';
      var inits = '<div class="options" style="clear:right"><span class="categories">' + Constant.LanguageData[lang].building_category + '</span>'
        + ' <span><input type="checkbox" id="empire_alternativeBuildingList" ' + (database.settings.alternativeBuildingList.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].alternativeBuildingList_description + '"> ' + Constant.LanguageData[lang].alternativeBuildingList + '</nobr></span>'
        + ' <span><input type="checkbox" id="empire_compressedBuildingList" ' + (database.settings.compressedBuildingList.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].compressedBuildingList_description + '"> ' + Constant.LanguageData[lang].compressedBuildingList + '</nobr></span>'
        + ' <hr>'
        + ' <span class="categories">' + Constant.LanguageData[lang].resource_category + '</span>'
        + ' <span><input type="checkbox" id="empire_hourlyRess" ' + (database.settings.hourlyRess.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].hourlyRes_description + '"> ' + Constant.LanguageData[lang].hourlyRes + '</nobr></span>'
        + ' ' + wineOut + ''
        + ' <span><input type="checkbox" id="empire_dailyBonus" ' + (database.settings.dailyBonus.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].dailyBonus_description + '"> ' + Constant.LanguageData[lang].dailyBonus + '</nobr></span>'
        + ' <span><input type="checkbox" id="empire_wineWarning" ' + (database.settings.wineWarning.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].wineWarning_description + '"> ' + Constant.LanguageData[lang].wineWarning + '</nobr></span>'
        + ' <span><select id="empire_wineWarningTime"><option value="0"' + (database.settings.wineWarningTime.value === 0 ? 'selected=selected' : '') + '> ' + Constant.LanguageData[lang].off + '</option><option value="12"' + (database.settings.wineWarningTime.value == 12 ? 'selected=selected' : '') + '> 12' + Constant.LanguageData[lang].hour + '</option><option value="24"' + (database.settings.wineWarningTime.value == 24 ? 'selected=selected' : '') + '> 24' + Constant.LanguageData[lang].hour + '</option><option value="36"' + (database.settings.wineWarningTime.value == 36 ? 'selected=selected' : '') + '> 36' + Constant.LanguageData[lang].hour + '</option><option value="48"' + (database.settings.wineWarningTime.value == 48 ? 'selected=selected' : '') + '> 48' + Constant.LanguageData[lang].hour + '</option><option value="96"' + (database.settings.wineWarningTime.value == 96 ? 'selected=selected' : '') + '> 96' + Constant.LanguageData[lang].hour + '</option></select><nobr data-tooltip="' + Constant.LanguageData[lang].wineWarningTime_description + '"> ' + Constant.LanguageData[lang].wineWarningTime + '</nobr></span>'
        + ' <hr>'
        + ' <span class="categories">' + Constant.LanguageData[lang].language_category + '</span>'
        + ' <span><select id="empire_languageChange"><option value="en"' + (database.settings.languageChange.value == 'en' ? 'selected=selected' : '') + '> ' + Constant.LanguageData[lang].en + '</option></select><nobr data-tooltip="' + Constant.LanguageData[lang].languageChange_description + '"> ' + Constant.LanguageData[lang].languageChange + '</nobr></span>'
        + '</div>';
      var features = '<div class="options">'
        + ' <span class="categories">' + Constant.LanguageData[lang].visibility_category + '</span>'
        + ' <span><input type="checkbox" id="empire_hideOnWorldView" ' + (database.settings.hideOnWorldView.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].hideOnWorldView_description + '"> ' + Constant.LanguageData[lang].hideOnWorldView + '</nobr></span>'
        + ' <span><input type="checkbox" id="empire_hideOnIslandView" ' + (database.settings.hideOnIslandView.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].hideOnIslandView_description + '"> ' + Constant.LanguageData[lang].hideOnIslandView + '</nobr></span>'
        + ' <span><input type="checkbox" id="empire_hideOnCityView" ' + (database.settings.hideOnCityView.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].hideOnCityView_description + '"> ' + Constant.LanguageData[lang].hideOnCityView + '</nobr></span>'
        + ' <hr>'
        + ' <span class="categories">' + Constant.LanguageData[lang].army_category + '</span>'
        + ' <span><input type="checkbox" id="empire_fullArmyTable" ' + (database.settings.fullArmyTable.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].fullArmyTable_description + '"> ' + Constant.LanguageData[lang].fullArmyTable + '</nobr></span>'
        // + ' <span><input type="checkbox" id="empire_playerInfo" ' + (database.settings.playerInfo.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="'+ Constant.LanguageData[lang].playerInfo_description +'"> '+ Constant.LanguageData[lang].playerInfo +'</nobr></span>'
        + ' <span><input type="checkbox" id="empire_onIkaLogs" ' + (database.settings.onIkaLogs.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].onIkaLogs_description + '"> ' + Constant.LanguageData[lang].onIkaLogs + '</nobr></span>'
        + ' <hr>'
        + ' <span class="categories">' + Constant.LanguageData[lang].global_category + '</span>'
        + ' <span><input type="checkbox" id="empire_autoUpdates" ' + (database.settings.autoUpdates.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].autoUpdates_description + '"> ' + Constant.LanguageData[lang].autoUpdates + '</nobr></span>'
        + '</div>';
      var display = '<div class="options">'
        + ' <span class="categories">' + Constant.LanguageData[lang].display_category + '</span>'
        + ' <span><input type="checkbox" id="empire_onTop" ' + (database.settings.onTop.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].onTop_description + '"> ' + Constant.LanguageData[lang].onTop + '</nobr></span>'
        + ' <span><input type="checkbox" id="empire_windowTennis" ' + (database.settings.windowTennis.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].windowTennis_description + '"> ' + Constant.LanguageData[lang].windowTennis + '</nobr></span>'
        + ' <span><input type="checkbox" id="empire_smallFont" ' + (database.settings.smallFont.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].smallFont_description + '"> ' + Constant.LanguageData[lang].smallFont + '</nobr></span>'
        + ' <span><input type="checkbox" id="empire_GoldShort" ' + (database.settings.GoldShort.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].goldShort_description + '"> ' + Constant.LanguageData[lang].goldShort + '</nobr></span>'
        + ' <span><input type="checkbox" id="empire_newsTicker" ' + (database.settings.newsTicker.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].newsticker_description + '"> ' + Constant.LanguageData[lang].newsticker + '</nobr></span>'
        + ' <span><input type="checkbox" id="empire_event" ' + (database.settings.event.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].event_description + '"> ' + Constant.LanguageData[lang].event + '</nobr></span>'
        + ' <span><input type="checkbox" id="empire_logInPopup" ' + (database.settings.logInPopup.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].logInPopup_description + '"> ' + Constant.LanguageData[lang].logInPopup + '</nobr></span>'
        + ' <span><input type="checkbox" id="empire_birdSwarm" ' + (database.settings.birdSwarm.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].birdswarm_description + '"> ' + Constant.LanguageData[lang].birdswarm + '</nobr></span>'
        + ' <span><input type="checkbox" id="empire_walkers" ' + (database.settings.walkers.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].walkers_description + '"> ' + Constant.LanguageData[lang].walkers + '</nobr></span>'
        + ' ' + piracy + ''
        + ' <span><input type="checkbox" id="empire_controlCenter" ' + (database.settings.controlCenter.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].control_description + '"> ' + Constant.LanguageData[lang].control + '</nobr></span>'
        + ' <span><input type="checkbox" id="empire_withoutFable" ' + (database.settings.withoutFable.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].unnecessaryTexts_description + '"> ' + Constant.LanguageData[lang].unnecessaryTexts + '</nobr></span>'
        + ' <span><input type="checkbox" id="empire_ambrosiaPay" ' + (database.settings.ambrosiaPay.value ? 'checked="checked"' : '') + '/><nobr data-tooltip="' + Constant.LanguageData[lang].ambrosiaPay_description + '"> ' + Constant.LanguageData[lang].ambrosiaPay + '</nobr></span>'
        + '</div>';
      elems += features + inits + display + '<div style="clear:left"></div>';
      elems += '</div></div>';
      elems += '<div style="clear:left"><hr><p>&nbsp; ' + Constant.LanguageData[lang].current_Version + ' <b>&nbsp;' + empire.version + '</b></p><p>&nbsp; ' + Constant.LanguageData[lang].ikariam_Version + ' <b style="cursor:pointer;" onclick="ajaxHandlerCall(\'?view=version\')">&nbsp;' + ikariam.GameVersion() + '</b></p></div><br>';
      elems += '<div class="buttons">' + '<button data-tooltip="' + Constant.LanguageData[lang].reset + '" id="empire_Reset_Button">Reset</button>' + '<button data-tooltip="' + Constant.LanguageData[lang].goto_website + '" id="empire_Website_Button">' + Constant.LanguageData[lang].website + '</button>' + '<button data-tooltip="' + Constant.LanguageData[lang].Check_for_updates + '" id="empire_Update_Button">' + Constant.LanguageData[lang].check + '</button>' + '<button data-tooltip="' + Constant.LanguageData[lang].Report_bug + '" id="empire_Bug_Button">' + Constant.LanguageData[lang].report + '</button>' + '<button data-tooltip="' + Constant.LanguageData[lang].save_settings + '" id="empire_Save_Button" onclick="ajaxHandlerCall(\'?view=city&oldBackgroundView\')">' + Constant.LanguageData[lang].save + '</button>';
      return elems;
    },
    DrawHelp: function () {
      var lang = database.settings.languageChange.value;
      $('#HelpTab').html(this.getHelpTable(
      )).on("click", "#helpTownhall", function () {
        ikariam.loadUrl(ikariam.viewIsCity, "city", ikariam.getCurrentCity.getBuildingFromName(Constant.Buildings.TOWN_HALL).getUrlParams);
      }).on("click", "#helpMilitary", function () {
        ikariam.loadUrl(ikariam.viewIsCity, "city", { view: 'cityMilitary', activeTab: 'tabUnits' });
      }).on("click", "#helpMuseum", function () {
        ikariam.loadUrl(ikariam.viewIsCity, "city", { view: 'culturalPossessions_assign', activeTab: 'tab_culturalPossessions_assign' });
      }).on("click", "#helpResearch", function () {
        ikariam.loadUrl(ikariam.viewIsCity, "city", { view: 'researchAdvisor' });
      }).on("click", "#helpPalace", function () {
        var capital = ikariam.getCapital;
        if (capital) {
          ikariam.loadUrl(ikariam.viewIsCity, "city", capital.getBuildingFromName(Constant.Buildings.PALACE).getUrlParams);
        }
        else alert(Constant.LanguageData[lang].alert_palace);
      }).on("click", "#helpFinance", function () {
        ikariam.loadUrl(ikariam.viewIsCity, "city", { view: 'finances' });
      }).on("click", "#helpShop", function () {
        ikariam.loadUrl(ikariam.viewIsCity, "city", { view: 'premium' });
      });
    },
    DrawSettings: function () {
      var lang = database.settings.languageChange.value;
      $('#SettingsTab').html(this.getSettingsTable(
      )).on("change", "#empire_onTop", function () {
        database.settings.onTop.value = this.checked;
        render.mainContentBox.css('z-index', this.checked ? 65112 : 61);
      }).on("change", "#empire_windowTennis", function () {
        database.settings.windowTennis.value = this.checked;
        if (!this.checked) {
          render.mainContentBox.css('z-index', database.settings.onTop.value ? 65112 : 61);
        }
        else {
          render.mainContentBox.trigger('mouseenter');
        }
      }).on("change", "#empire_fullArmyTable", function () {
        database.settings.fullArmyTable.value = this.checked;
        render.updateCitiesArmyData();
      }).on("change", "#empire_playerInfo", function () {
        database.settings.playerInfo.value = this.checked;
      }).on("change", "#empire_onIkaLogs", function () {
        database.settings.onIkaLogs.value = this.checked;
      }).on("change", "#empire_controlCenter", function () {
        database.settings.controlCenter.value = this.checked;
      }).on("change", "#empire_withoutFable", function () {
        database.settings.withoutFable.value = this.checked;
      }).on("change", "#empire_ambrosiaPay", function () {
        database.settings.ambrosiaPay.value = this.checked;
      }).on("change", "#empire_hideOnWorldView", function () {
        database.settings.hideOnWorldView.value = this.checked;
      }).on("change", "#empire_hideOnIslandView", function () {
        database.settings.hideOnIslandView.value = this.checked;
      }).on("change", "#empire_hideOnCityView", function () {
        database.settings.hideOnCityView.value = this.checked;
      }).on("change", "#empire_autoUpdates", function () {
        database.settings.autoUpdates.value = this.checked;
      }).on("change", "#empire_smallFont", function () {
        database.settings.smallFont.value = this.checked;
        if (this.checked) { GM_addStyle("#empireBoard {font-size:8pt}"); }
        else { GM_addStyle("#empireBoard {font-size:inherit}"); }
      }).on("change", "#empire_GoldShort", function () {
        database.settings.GoldShort.value = this.checked;
      }).on("change", "#empire_newsTicker", function () {
        database.settings.newsTicker.value = this.checked;
      }).on("change", "#empire_event", function () {
        database.settings.event.value = this.checked;
      }).on("change", "#empire_birdSwarm", function () {
        database.settings.birdSwarm.value = this.checked;
      }).on("change", "#empire_walkers", function () {
        database.settings.walkers.value = this.checked;
      }).on("change", "#empire_noPiracy", function () {
        database.settings.noPiracy.value = this.checked;
      }).on("change", "#empire_hourlyRess", function () {
        database.settings.hourlyRess.value = this.checked;
      }).on("change", "#empire_wineWarning", function () {
        database.settings.wineWarning.value = this.checked;
      }).on("change", "#empire_wineOut", function () {
        database.settings.wineOut.value = this.checked;
      }).on("change", "#empire_dailyBonus", function () {
        database.settings.dailyBonus.value = this.checked;
      }).on("change", "#empire_logInPopup", function () {
        database.settings.logInPopup.value = this.checked;
        if (this.checked)
          alert(Constant.LanguageData[lang].alert_daily);
      }).on("change", "#empire_alternativeBuildingList", function () {
        database.settings.alternativeBuildingList.value = this.checked;
        render.cityRows.building = {};
        if (database.settings.alternativeBuildingList.value == this.checked && database.settings.compressedBuildingList.value == 1) {
          alert(Constant.LanguageData[lang].alert);
        }
        $('table.buildings').html(render.getBuildingTable());
        render.updateCitiesBuildingData();
        $.each(database.cities, function (cityId, city) {
          render.setCityName(city);
          render.setActionPoints(city);
          $.each(database.settings[Constant.Settings.CITY_ORDER].value, function (idx, val) {
            $('#' + 'building' + '_' + val).appendTo($('#' + 'building' + '_' + val).parent());
          });
        });
      }).on("change", "#empire_compressedBuildingList", function () {
        database.settings.compressedBuildingList.value = this.checked;
        if (database.settings.compressedBuildingList.value == this.checked && database.settings.alternativeBuildingList.value == 1) {
          alert(Constant.LanguageData[lang].alert);
        }
        render.cityRows.building = {};
        $('table.buildings').html(render.getBuildingTable());
        render.updateCitiesBuildingData();
        $.each(database.cities, function (cityId, city) {
          render.setCityName(city);
          render.setActionPoints(city);
          $.each(database.settings[Constant.Settings.CITY_ORDER].value, function (idx, val) {
            $('#' + 'building' + '_' + val).appendTo($('#' + 'building' + '_' + val).parent());
          });
        });
      }).on('change', "#empire_wineWarningTime", function () {
        database.settings.wineWarningTime.value = this.value;
      }).on('change', "#empire_languageChange", function () {
        database.settings.languageChange.value = this.value;
      }).on("click", "#empire_Website_Button", function () {
        GM_openInTab('https://greasyfork.org/scripts/764-empire-overview');
      }).on("click", "#empire_Reset_Button", function () {
        empire.HardReset();
      }).on("click", "#empire_Update_Button", function () {
        empire.CheckForUpdates.call(empire, true);
      }).on("click", "#empire_Bug_Button", function () {
        GM_openInTab('https://greasyfork.org/scripts/764-empire-overview/feedback');
      }).on("change", "input[type='checkbox']", function () {
        this.blur();
      });
      $(document).ready(function () {  //todo
        if ($('#empire_dailyBonus').attr('checked') && $('#dailyActivityBonus form')) {
          $('#dailyActivityBonus form').submit();
        }
        if ($('#empire_logInPopup').attr('checked')) {
          GM_addStyle('#multiPopup {display: none;}');
        }
        if ($('#empire_dailyBonus').attr('checked') && $('#empire_logInPopup').attr('checked')) {
          GM_addStyle('#multiPopup {display: none;}');
        }
      });
      $("#empire_Reset_Button").button({ icons: { primary: "ui-icon-alert" }, text: true });
      $("#empire_Website_Button").button({ icons: { primary: "ui-icon-home" }, text: true });
      $("#empire_Update_Button").button({ icons: { primary: "ui-icon-info" }, text: true });
      $("#empire_Bug_Button").button({ icons: { primary: "ui-icon-notice" }, text: true });
      $("#empire_Save_Button").button({ icons: { primary: "ui-icon-check" }, text: true });
      $("#empire_Allianz").button({ text: true });
      $("#empire_Allianz_einlesen").button({ text: true });
    },
    toast: function (sMessage) {
      $('<div>').addClass("ui-tooltip-content ui-widget-content").text(sMessage).appendTo($(document.createElement("div")).addClass("ui-helper-reset ui-tooltip ui-tooltip-pos-bc ui-widget").css({ position: 'relative', display: 'inline-block', left: 'auto', top: 'auto' }).show().appendTo($(document.createElement("div")).addClass("toast").appendTo(document.body).delay(100).fadeIn("slow", function () {
        $(this).delay(2000).fadeOut("slow", function () {
          $(this).remove();
        });
      })));
    },
    toastAlert: function (sMessage) {
      $('<div class="red">').addClass("ui-tooltip-content ui-widget-content").text(sMessage).appendTo($(document.createElement("div")).addClass("ui-helper-reset ui-tooltip ui-tooltip-pos-bc ui-widget").css({ position: 'relative', display: 'inline-block', left: 'auto', top: '-20px' }).show().appendTo($(document.createElement("div")).addClass("toastAlert").appendTo(document.body).delay(100).fadeIn("slow", function () {
        $(this).delay(3000).fadeOut("slow", function () {
          $(this).remove();
        });
      })));
    },
    RestoreDisplayOptions: function () {
      render.mainContentBox.css('left', database.settings.window.left);
      render.mainContentBox.css('top', database.settings.window.top);
      this.$tabs.tabs('select', database.settings.window.activeTab);
      if (!(ikariam.viewIsWorld && database.settings.hideOnWorldView.value || ikariam.viewIsIsland && database.settings.hideOnIslandView.value || ikariam.viewIsCity && database.settings.hideOnCityView.value) && database.settings.window.visible)
        this.mainContentBox.fadeToggle('slow');
    },
    SaveDisplayOptions: function () {
      if (database.settings)
        try {
          database.settings.addOptions({
            window: {
              left: render.mainContentBox.css('left'),
              top: render.mainContentBox.css('top'),
              visible: (ikariam.viewIsWorld && database.settings.hideOnWorldView.value || ikariam.viewIsIsland && database.settings.hideOnIslandView.value || ikariam.viewIsCity && database.settings.hideOnCityView.value) ? database.settings.window.visible : (render.mainContentBox.css('display') != 'none'),
              activeTab: render.$tabs.tabs('option', 'active')
            }
          });
        } catch (e) {
          empire.error('SaveDisplayOptions', e);
        }
    },
    SidePanelButton: function () {
      $('#js_viewCityMenu').find('li.empire_Menu')
        .on("click", function (event) { render.ToggleMainBox(); })
        .on("contextmenu", function (event) {
          event.preventDefault();
          database.settings.window.left = 110;
          database.settings.window.top = 200;
          render.mainContentBox.css('left', database.settings.window.left);
          render.mainContentBox.css('top', database.settings.window.top);
        });
      $(document).on('keydown', function (event) {
        var index = -1;
        var type = event.target.nodeName.toLowerCase();
        if (type === 'input' || type === 'textarea' || type === 'select')
          return true;
        if (event.which === 32) {
          event.stopImmediatePropagation();
          render.ToggleMainBox();
          return false;
        }
        if (event.originalEvent.shiftKey) {

          index = [49, 50, 51, 52, 53].indexOf(event.which);
          if (index !== -1) {
            render.$tabs.tabs('option', 'active', index);
            return false;
          } else {
            switch (event.which) {
              case 81:
                $('#js_worldMapLink').find('a').click();
                break;
              case 87:
                $('#js_islandLink').find('a').click();
                break;
              case 69:
                $('#js_cityLink').find('a').click();
                break;
            }
          }
        } else {
          var keycodes = '';
          var codeTyp = ikariam.Nationality();
          switch (codeTyp) {
            case 'en':
            case 'gr':
            case 'ro':
            case 'ru':
            case 'pl':
            case 'ir':
            case 'ae':
            case 'au':
            case 'br':
            case 'hk':
            case 'hu': // code 0,0 ü ó
            case 'il':
            case 'lt':
            case 'nl':
            case 'tw':
            case 'us':
              keycodes = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 173, 61]; //EN - =
              if (isChrome)
                keycodes = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 189, 187]; //US - =
              break;
            case 'de':
              keycodes = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 63, 192]; //DE ß ´
              if (isChrome)
                keycodes = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 219, 221]; //DE ß ´
              break;
            case 'it':
              keycodes = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 222, 160]; //IT + \
              break;
            case 'es':
            case 'rs':
            case 'si':
              keycodes = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 222, 171]; //ES, RS, SI ' +
              break;
            case 'ar':
            case 'cl':
            case 'co':
            case 'mx':
            case 'pe':
            case 'pt':
            case 've':
              keycodes = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 222, 0]; //AR, CL, CO, MX, VE, PE ' ¿  PT ' «
              break;
            case 'fr':
              keycodes = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 169, 61]; //FR ) =
              break;
            case 'cz':
              keycodes = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 61, 169]; //CZ = )
              break;
            case 'bg':
              keycodes = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 173, 190]; //BG - .
              break;
            case 'dk':
            case 'fi':
            case 'ee':
            case 'se':
              keycodes = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 171, 192]; //DK, FI, EE, SE + ´
              break;
            case 'no':
              keycodes = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 171, 222]; //NO + \
              break;
            case 'tr':
              keycodes = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 170, 173]; //TR * -
              break;
            case 'sk':
              keycodes = [49, 50, 51, 52, 53, 54, 55, 56, 57, 48, 61, 0]; //SK = ´
              break;
          }
          index = keycodes.indexOf(event.which);
          if (index !== -1) {
            if (index < database.settings.cityOrder.value.length) {
              $('#resource_' + database.settings.cityOrder.value[index] + ' .city_name .clickable').trigger('click');
              return false;
            }
          } else {
            switch (event.which) {
              case 81:
                $('#js_GlobalMenu_cities').click();
                break;
              case 87:
                $('#js_GlobalMenu_military').click();
                break;
              case 69:
                $('#js_GlobalMenu_research').click();
                break;
              case 82:
                $('#js_GlobalMenu_diplomacy').click();
                break;
            }
          }
        }
      });
    },
    ToggleMainBox: function () {
      database.settings.window.visible = (this.mainContentBox.css('display') == 'none');
      this.mainContentBox.fadeToggle("slow");
    },
    DrawTables: function () {
      if ($(this.mainContentBox)) {
        $('#ArmyTab').html(this.getArmyTable());
        $('#ResTab').html(this.getResourceTable());
        $('#BuildTab').html(this.getBuildingTable());
        $('#WorldmapTab').html(this.getWorldmapTable());
        this.DrawSettings();
        this.DrawHelp();
        this.toolTip.init();
        $('#ResTab, #BuildTab, #ArmyTab').each(function () {
          $(this).sortable({
            helper: function (e, ui) {
              ui.children('td').each(function () {
                $(this).width(Math.round($(this).width()));
                $(this).hasClass('building'); if ($(this).css('border', '1px solid transparent'));
              });
              ui.parents('div[role=tabpanel]').each(function () {
                $(this).width(Math.round($(this).width()));
              });
              return ui;
            },
            handle: '.city_name .icon',
            cursor: "move",
            axis: 'y',
            items: 'tbody tr',
            container: 'tbody',
            revert: 200,
            stop: function (event, ui) {
              ui.item.parents("div[role=tabpanel]").css("width", "");
              ui.item.children("td").css("width", "").css("border", "");
              database.settings[Constant.Settings.CITY_ORDER].value = ui.item.parents('.ui-sortable').sortable('toArray').map(function (item) {
                return parseInt(item.split('_').pop());
              });
              $.each(['building', 'resource', 'army'], function (idx, type) {
                if ($(this).parents('.ui-sortable').attr('id') !== type) {
                  $.each(database.settings[Constant.Settings.CITY_ORDER].value, function (idx, val) {
                    $('#' + type + '_' + val).appendTo($('#' + type + '_' + val).parent());
                  });
                }
              });
            }
          });
        });
        $.each(['building', 'resource', 'army'], function (idx, type) {
          $.each(database.settings[Constant.Settings.CITY_ORDER].value, function (idx, val) {
            $('#' + type + '_' + val).appendTo($('#' + type + '_' + val).parent());
          });
        });
      }
      this.AttachClickHandlers();
    },
        // small generators to produce per-resource and per-city fragments (DRY)
    _makeResourceCell: function (resourceName) {
      return '<td class="resource ' + resourceName + '">\n' +
        '    <span class="icon safeImage"></span>\n' +
        '    <span class="current"></span>\n' +
        '   <span class="incoming" data-tooltip="dynamic"></span>\n' +
        '    <div class="progressbar ui-progressbar ui-widget ui-widget-content ui-corner-all" data-tooltip="dynamic">\n' +
        '      <div class="ui-progressbar-value ui-widget-header ui-corner-left" style="width: 95%"></div>\n' +
        '    </div>\n' +
        '</td>\n' +
        '<td class="resource ' + resourceName + '">\n' +
        '    <span class="prodconssubsum production Green" data-tooltip="dynamic"></span>\n' +
        '    <span class="prodconssubsum consumption Red" data-tooltip="dynamic"></span>\n' +
        '    <span class="emptytime Red"></span>\n' +
        '</td>';
    },
    _makeResourceRow: function (city) {
      var lang = database.settings.languageChange.value;
      var resourceCells = '';
      // build the repeated resource cells by iterating the resource list
      $.each(Constant.Resources, function (key, resourceName) {
        resourceCells += render._makeResourceCell(resourceName);
      });

      var info = city.isUpgrading === true ? '!' : '';
      var progSci = '';
      if (city.getBuildingFromName && city.getBuildingFromName(Constant.Buildings.ACADEMY)) {
        progSci = '<div class="progressbarSci ui-progressbar ui-widget ui-widget-content ui-corner-all" data-tooltip="dynamic">' +
                  '<div class="ui-progressbar-value ui-widget-header ui-corner-left" style="width: 95%"></div></div>';
      }
      var wonder_size = 25;
      var row = '<tr id="resource_{0}">\n' +
        '  <td class="city_name">\n' +
        '    <span></span>\n' +
        '    <span class="clickable">{2}</span>\n' +
        '    <sub>{3}</sub>\n' +
        '    <span class="Red" data-tooltip="{6}">&nbsp;&nbsp;<b>{5}</b>&nbsp;&nbsp;</span>\n' +
        '  </td>\n' +
        '  <td class="action_points"><span class="ap"></span>&nbsp;<br><span class="garrisonlimit" data-tooltip="dynamic"><img height="18" hspace="3"></span></td>\n' +
        '  <td class="empireactions">\n' +
        '    <div class="worldmap" data-tooltip="{7}" style="cursor:pointer;"></div>\n' +
        '    <div class="city" data-tooltip="{8}" style="cursor:pointer;"></div>\n' +
        '    <div class="island" data-tooltip="{9}" style="cursor:pointer;"></div>\n' +
        '    <div class="islandwood" data-tooltip="{10}" style="cursor:pointer;"></div>\n' +
        '    <div class="islandgood" style="background: url(/cdn/all/both/resources/icon_{11}.png) no-repeat center center; background-size: 18px auto; cursor: pointer;" data-tooltip="{12}"></div>\n' +
        '    <div class="transport" data-tooltip="{13}" style="cursor:pointer;"></div>\n' +
        '  </td>\n' +
        '  <td class="population" data-tooltip="dynamic">\n' +
        '    <span class="pop" data-tooltip="dynamic"></span>\n' +
        '    <span></span>\n' +
        '    <div class="progressbarPop ui-progressbar ui-widget ui-widget-content ui-corner-all" data-tooltip="dynamic">\n' +
        '      <div class="ui-progressbar-value ui-widget-header ui-corner-left" style="width: 95%"></div>\n' +
        '    </div>\n' +
        '  </td>\n' +
        '  <td class="population_happiness"><span class="happy" data-tooltip="dynamic"><img align=right height="18" hspace="8" vspace="2"></span><br><span class="growth clickbar"></span></td>\n' +
        '  <td class="research" data-tooltip="dynamic"><span class="scientists" data-tooltip="dynamic"></span><span></span>' + progSci + '</td>\n' +
        '  ' + resourceCells + '\n' +
        '</tr>';

      return Utils.format(row, [city.getId, /* placeholder for older code */ '', city.getName || '', city.getAvailableBuildings || '', progSci, info, info ? Constant.LanguageData[lang].constructing : '', Constant.LanguageData[lang].to_world, Constant.LanguageData[lang].to_town_hall + ' {2}', Constant.LanguageData[lang].to_island, Constant.LanguageData[lang].to_saw_mill, city.getTradeGood, Constant.LanguageData[lang].to_mine, Constant.LanguageData[lang].transporting]);
    },
    getResourceTable: function () {
      var lang = database.settings.languageChange.value;

      var header = '<colgroup span="2"/>\n' +
        '<colgroup span="1"/>\n' +
        '<colgroup span="1"/>\n' +
        '<colgroup span="2"/>\n' +
        '<colgroup span="2"/>\n' +
        '<colgroup span="2"/>\n' +
        '<colgroup span="2"/>\n' +
        '<colgroup span="2"/>\n' +
        '<colgroup span="2"/>\n' +
        '<colgroup span="2"/>\n' +
        '<thead>\n' +
        '<tr class="header_row">\n' +
        '  <th class="city_name" data-tooltip="{10}" style="cursor:pointer;" onclick="ajaxHandlerCall(\'?view=ikipedia&helpId=18\')">{0}</th>\n' +
        '  <th class="action_points icon actionpointImage" data-tooltip="{1}"></th>\n' +
        '  <th class="empireactions"></th>\n' +
        '  <th class="citizen_header icon populationImage" data-tooltip="{2}" style="cursor:pointer;" onclick="ajaxHandlerCall(\'?view=ikipedia&helpId=3\');return false;"></th>\n' +
        '  <th class="growth_header icon growthImage" data-tooltip="' + Constant.LanguageData[lang].satisfaction + '" style="cursor:pointer;" onclick="ajaxHandlerCall(\'?view=ikipedia&helpId=3\');return false;"></th>\n' +
        '  <th class="research_header icon researchImage" data-tooltip="{3}" style="cursor:pointer;" onclick="ajaxHandlerCall(\'?view=researchAdvisor\');return false;"></th>\n' +
        '  <th class="gold_header icon goldImage" colspan="2" data-tooltip="{4}" style="cursor:pointer;" onclick="ajaxHandlerCall(\'?view=finances\');return false;"></th>\n' +
        '  <th class="wood_header icon woodImage" colspan="2" data-tooltip="{5}" style="cursor:pointer;" onclick="ajaxHandlerCall(\'?view=ikipedia&helpId=5\');return false;"></th>\n' +
        '  <th class="wine_header icon wineImage" colspan="2" data-tooltip="{6}" style="cursor:pointer;" onclick="ajaxHandlerCall(\'?view=ikipedia&helpId=6\');return false;"></th>\n' +
        '  <th class="marble_header icon marbleImage" colspan="2" data-tooltip="{7}" style="cursor:pointer;" onclick="ajaxHandlerCall(\'?view=ikipedia&helpId=6\');return false;"></th>\n' +
        '  <th class="glass_header icon glassImage" colspan="2" data-tooltip="{8}" style="cursor:pointer;" onclick="ajaxHandlerCall(\'?view=ikipedia&helpId=6\');return false;"></th>\n' +
        '  <th class="sulfur_header icon sulfurImage" colspan="2" data-tooltip="{9}" style="cursor:pointer;" onclick="ajaxHandlerCall(\'?view=ikipedia&helpId=6\');return false;"></th>\n' +
        '</tr>\n' +
        '</thead>';

      var tableTpl = '<table class="resources">\n{0}\n<tbody>{1}</tbody>\n<tfoot>{2}</tfoot>\n</table>';

      function getBody() {
        var rows = '';
        $.each(database.cities, function (cityId, city) {
          rows += render._makeResourceRow(city);
        });
        return rows;
      }

      function getFooter() {
        // Keep the original footer markup (kept minimal here)
        return '<tr>\n<td colspan="2"></td>\n<td id="t_sigma" class="total" data-tooltip="dynamic">Σ</td>\n<td id="t_population" class="total"></td><td id="t_growth" class="total"></td>\n<td id="t_research" class="total" data-tooltip="dynamic"></td>\n<td id="t_currentgold" class="total"></td>\n<td id="t_goldincome" class="total" data-tooltip="dynamic">\n  <span class="Green"></span>\n  <span class="Red"></span>\n<td id="t_currentwood" class="total"></td>\n<td id="t_woodincome" class="total" data-tooltip="dynamic">\n  <span class="Green"></span>\n  <span class="Red"></span>\n</td>\n<td id="t_currentwine" class="total"></td>\n<td id="t_wineincome" class="total" data-tooltip="dynamic">\n  <span class="Green"></span>\n  <span class="Red"></span>\n</td>\n<td id="t_currentmarble" class="total"></td>\n<td id="t_marbleincome" class="total"data-tooltip="dynamic">\n  <span class="Green"></span>\n  <span class="Red"></span>\n</td>\n<td id="t_currentglass" class="total"></td>\n<td id="t_glassincome" class="total" data-tooltip="dynamic">\n  <span class="Green"></span>\n  <span class="Red"></span>\n</td>\n<td id="t_currentsulfur" class="total"></td>\n<td id="t_sulfurincome" class="total" data-tooltip="dynamic">\n  <span class="Green"></span>\n  <span class="Red"></span>\n</td>\n</tr>';
      }

      return Utils.format(tableTpl, [header, getBody(), getFooter()]);
    },
    getArmyTable: function () {
      var lang = database.settings.languageChange.value;
      var table = '<table class="army">\n    {0}\n    <tbody>{1}</tbody>\n    <tfoot>{2}</tfoot>\n</table>';
      var headerRow = '<thead><tr class="header_row">\n    <th class="city_name">{0}</th>\n    <th data-tooltip="{1}" class="icon actionpointImage action_points" >\n <th class="empireactions" colspan="2">\n       <div class="spio" data-tooltip="' + Constant.LanguageData[lang].espionage + '" style="cursor:pointer;"></div>\n<div class="combat"data-tooltip="' + Constant.LanguageData[lang].combat + '" style="cursor:pointer;"></div>\n  </th><th class="expenses_header icon expensesImage"data-tooltip="' + Constant.LanguageData[lang].expenses + '"></th>\n\n    {2}\n</tr></thead>';
      var headerCell = '<th data-tooltip="{0}" style="background:url(\'{1}\')  no-repeat center center; background-size: auto 24px; cursor: pointer;" colspan="2" class="army unit icon {2}" onclick="ajaxHandlerCall(\'?view=unitdescription&{5}Id={3}&helpId={4}\'); return false;">&nbsp;</th>\n\n';
      var bodyRow = '<tr id="army_{0}">\n    <td class="city_name"><img><span class="clickable"></span><sub></sub></td>\n    <td class="action_points"><span class="ap"></span>&nbsp;&nbsp;<br><span class="garrisonlimit"  data-tooltip="dynamic"><img height="18" hspace="5"></span></td>\n    <td class="empireactions">\n     <div class="deploymentarmy"data-tooltip="' + Constant.LanguageData[lang].transporting_units + '&nbsp;{2}" style="cursor:pointer;"></div>\n  <br>  <div class="deploymentfleet" data-tooltip="' + Constant.LanguageData[lang].transporting_fleets + '&nbsp;{2}" style="cursor:pointer;"></div>\n</td> \n <td class="empireactions">{3} <br> {4}  \n    </td>\n <td class="expenses"> {5} </td>\n   {1}\n</tr>';
      var bodyCell = '</td><td style="" class="army unit {0}">\n    <span>{1}</span>\n</td>\n<td style="" class="army movement {0}" data-tooltip="dynamic">\n    <span class="More Green {0}">{2}</span>\n  <br>  <span class="More Blue {0}">{3}</span>\n</td>';
      var costCell = '';
      var footerRow = '<tr class="totals_row">\n    <td class="city_name"></td>\n    <td></td>\n   <td class="sigma" colspan="2">Σ</td><td>&nbsp;{1}&nbsp;</td>\n    {0}\n</tr>';
      var footerCell = '<td class="army total {0} unit">\n    <span></span>\n</td>\n<td style="" class="army total {0} movement">\n    <span class="More Green"></span>\n    <span class="More Blue"></span>\n</td>';

      return Utils.format(table, [getHead(), getBody(), getFooter()]);

      function getHead() {
        var headerCells = '';
        var cols = '<colgroup span=4/><colgroup></colgroup>';
        for (var category in Constant.unitOrder) {
          cols += '<colgroup>';
          $.each(Constant.unitOrder[category], function (index, value) {
            var helpId = 9;
            var unit = 'unit';
            if (Constant.UnitData[value].id < 300) {
              helpId = 10;
              unit = 'ship';
            }
            headerCells += Utils.format(headerCell, [Constant.LanguageData[lang][value], getImage(value), value, Constant.UnitData[value].id, helpId, unit]);
            cols += '<col><col>';
          });
          cols += '</colgroup>';
        }
        return cols + Utils.format(headerRow, [Constant.LanguageData[lang].towns, Constant.LanguageData[lang].actionP, headerCells]);
      }

      function getBody() {
        var body = '';
        $.each(database.cities, function (cityId, city) {
          var rowCells = '';
          var divbarracks = '';
          if (this.getBuildingFromName(Constant.Buildings.BARRACKS)) {
            divbarracks = '<div class="barracks" data-tooltip="' + Constant.LanguageData[lang].to_barracks + '&nbsp;{2}" style="cursor:pointer;"></div>';
          }
          var divshipyard = '&nbsp;';
          if (this.getBuildingFromName(Constant.Buildings.SHIPYARD)) {
            divshipyard = '<div class="shipyard" data-tooltip="' + Constant.LanguageData[lang].to_shipyard + '&nbsp;{2}" style="cursor:pointer;"></div>';
          }
          var cost = 0; //city.military.getUnits.getUnit('phalanx')*Constant.UnitData.phalanx.baseCost; //geht für die Hopps todo, alle Einheiten integrieren
          for (var category in Constant.unitOrder) {
            $.each(Constant.unitOrder[category], function (index, value) {
              var builds = city.getUnitBuildsByUnit(value);
              rowCells += Utils.format(bodyCell, [value, city.military.getUnits.getUnit(value) || '', builds[value] ? builds[value] : '', '']);
            });
          }
          body += Utils.format(bodyRow, [city.getId, rowCells, city._name, divbarracks, divshipyard, cost]);
        });
        return body;
      }

      function getFooter() {
        var footerCells = '';
        var expense = Utils.FormatNumToStr(database.getGlobalData.finance.armyCost + database.getGlobalData.finance.fleetCost);
        for (var category in Constant.unitOrder) {
          $.each(Constant.unitOrder[category], function (index, value) {
            footerCells += Utils.format(footerCell, [value]);
          });
        }
        return Utils.format(footerRow, [footerCells, expense]);
      }

      function getImage(unitID) {
        return (Constant.UnitData[unitID].type == 'fleet') ? '/cdn/all/both/characters/fleet/60x60/' + unitID + '_faceright.png' : '/cdn/all/both/characters/military/x60_y60/y60_' + unitID + '_faceright.png';
      }
    },
    getBuildingTable: function () {
      var lang = database.settings.languageChange.value;
      var table = '<table class="buildings">\n{0}\n    <tbody>{1}</tbody>\n</table>';
      var headerCell = '<th data-tooltip="{0}" style="background-color: transparent; background-image: url(\'{1}\'); \n background-repeat: no-repeat; background-attachment: scroll; background-position: center center; background-clip: \n border-box; background-origin: padding-box; background-size: 50px auto; cursor: pointer;" colspan="{2}" class="icon" onclick="ajaxHandlerCall(\'?view=buildingDetail&helpId=1&buildingId={3}\');return false;">&nbsp;</th>';
      var headerRow = '<thead><tr class="header_row">\n    <th class="city_name">{0}</th>\n    <th data-tooltip="{1}" class="action_points icon actionpointImage"></th>\n  <th class="empireactions">\n  <div class="contracts" data-tooltip="' + Constant.LanguageData[lang].contracts + '" style="cursor:pointer;" onclick="ajaxHandlerCall(\'?view=diplomacyTreaty\')"></div></th>\n    {2}\n</tr></thead>';
      var buildingCell = '<td class="building {0}" data-tooltip="dynamic"></td>';
      var buildingRow = '<tr id="building_{0}">\n    <td class="city_name"><img><span class="clickable"></span><sub></sub></td>\n    <td class="action_points"><span class="ap"></span>&nbsp;&nbsp;<br><span class="garrisonlimit"  data-tooltip="dynamic"><img height="18" hspace="5"></span></td>\n    <td class="empireactions">\n  <div class="deploymentfleet"></div> <br>  <div class="transport" data-tooltip="' + Constant.LanguageData[lang].transporting + ' {2}" style="cursor:pointer;"></div>\n   </td>\n    {1}\n</tr>';
      var counts = database.getBuildingCounts;
      var buildingOrder = (database.settings.alternativeBuildingList.value ? Constant.altBuildingOrder : database.settings.compressedBuildingList.value ? Constant.compBuildingOrder : Constant.buildingOrder);

      return Utils.format(table, [getHead(), getBody()]);

      function getHead() {
        var headerCells = '';
        var colgroup = '<colgroup span="3"></colgroup>';
        for (var category in buildingOrder) {
          var cols = '';
          $.each(buildingOrder[category], function (index, value) {
            if (value == 'colonyBuilding') {
              if (!database.settings.compressedBuildingList.value || !counts[value]) {
                return true;
              }
              cols += '<col span="' + counts[value] + '">';
              headerCells += Utils.format(headerCell, [Constant.LanguageData[lang].palace + '/' + Constant.LanguageData[lang].palaceColony, Constant.BuildingData[Constant.Buildings.PALACE].icon, counts[value], "?view=buildingDetail&helpId=1&buildingId=" + Constant.BuildingData.palace.buildingId]);
            } else if (value == 'productionBuilding') {
              if (!database.settings.compressedBuildingList.value || !counts[value]) {
                return true;
              }
              cols += '<col span="' + counts[value] + '">';
              headerCells += Utils.format(headerCell, [Constant.LanguageData[lang].stonemason + '/' + Constant.LanguageData[lang].winegrower + '/' + Constant.LanguageData[lang].alchemist + '/' + Constant.LanguageData[lang].glassblowing, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAUCAMAAACknt2MAAABelBMVEUAAADp49mgkICxmnzVuIxMcwtciQ90pSC/tKR7aFWOfGmIdmPKr4lomxChyk/YxKjTyrzl2slrVkKBblu5ooXp0a3NwrOqm4uNeWRTMzMnGRZFQBvb0sS0p5j18OiTgW3cvpSeXF07JSSJUlLFeHY2NhZzrRKZh3XmyJwPCgl7jzSHyBXlx53EuateSje0amp0YE2Fc2FzSEeFqzfoyJftylO7l1312oXv0GzWyqzN0MH15b311WO3iy2jchyLXiuZrqtyt9uJx+bP2M789+/sz3nv2p7+5IOXZRWHVA/jxou7vquTyuS7x72MqKmEw+J/wOFdk6ylsaXsz6Xz1njKnzTBlkF6SAvhvE2TsraVzeiNyeZ8ttJ7v+EzXnXJ1M2tfiKts6S63ex2utyUw9hFhqV6ss2W0O7fvmDUrUJnnrOk0+tjq8602uzO6fbCyr7Eu6BqrM1tstS74fKbzeXS6/dvud7OrG1PlLeMwNfW7viu2e2i0ObK4OYudx14AAAAAXRSTlMAQObYZgAAAAFiS0dEAIgFHUgAAAAJcEhZcwAAAEgAAABIAEbJaz4AAAFfSURBVCgVBcFLTlNhGADQ8/29t/e/reVhChWkUDFRE0hM1IlxYiIzhy5EN+ASTNyBO3DoIpw7VBNAiga0QFKsPK7nBBARV4AiIq4ukUBWVd0bQI0OJJjPC3VcV0AVTdOGhKVot//0TEFR9pebWQ8J1d9qNjxZjhGKYV3XI7N7JLDfU+dh48HmekrKcjYab0m2Y7GeP9tb2ztCL5meT8J45UJre5KOrlZv/hr0TyeXk3p6sdBqfc96439p399GXdx2Pbxv47zTreeiGcxKAABF8aiA/tZjAZ5EfAYA0ALDFKsrB4Cn63sgwbOyVeYu4HnOL0BgJyJOFkR88jIiIiI+ouDVecfhMCIa5iLix1oEJDtnnShmZ2mcT8k5VXdzzpB20kn/8HJkcfVnw4c8V09znr5GSpsbX5qlruOvA7zZbbdXqvJWhfR799tgduzhnVY9z/vtnN9VdfvgLQAAAPgPmQZaHvndsJEAAAAASUVORK5CYII=', counts[value], "?view=buildingDetail&helpId=1&buildingId=21"]).replace('50px auto', '38px 28px');
            } else if (counts[value]) {
              cols += '<col span="' + counts[value] + '">'; //Constant.LanguageData[lang][value]
              headerCells += Utils.format(headerCell, [Constant.LanguageData[lang][value], Constant.BuildingData[value].icon, counts[value], "?view=buildingDetail&helpId=1&buildingId=" + Constant.BuildingData[value].buildingId]);
            }
          });
          if (cols !== '') {
            colgroup += '<colgroup>' + cols + '</colgroup>';
          }
        }
        return colgroup + Utils.format(headerRow, [Constant.LanguageData[lang].towns, Constant.LanguageData[lang].actionP, headerCells]);
      }

      function getBody() {
        var body = '';
        $.each(database.cities, function (cityId, city) {
          var rowCells = '';
          for (var category in buildingOrder) {
            $.each(buildingOrder[category], function (index, value) {
              if ((value == 'productionBuilding' || value == 'colonyBuilding') && !database.settings.compressedBuildingList.value) return false;
              var i = 0;
              while (i < counts[value]) {
                var cssClass = '';
                if (value == 'colonyBuilding') {
                  cssClass = city.isCapital ? Constant.Buildings.PALACE : Constant.Buildings.GOVERNORS_RESIDENCE;
                } else if (value == 'productionBuilding') {
                  switch (city.getTradeGoodID) {
                    case 1:
                      cssClass = Constant.Buildings.WINERY;
                      break;
                    case 2:
                      cssClass = Constant.Buildings.STONEMASON;
                      break;
                    case 3:
                      cssClass = Constant.Buildings.GLASSBLOWER;
                      break;
                    case 4:
                      cssClass = Constant.Buildings.ALCHEMISTS_TOWER;
                      break;
                  }
                } else {
                  cssClass = value;
                }
                cssClass += +i;
                rowCells += Utils.format(buildingCell, [cssClass]);
                i++;
              }
            });
          }
          body += Utils.format(buildingRow, [city.getId, rowCells, city._name]);
        });
        return body;
      }
    },
    AddIslandCSS: function () {
      if (!(/.*view=island.*/.test(window.document.location)))
        if (!this.cssResLoaded()) Utils.addStyleSheet('@import "https://' + ikariam.Host() + '/skin/compiled-' + ikariam.Nationality() + '-island.css";');
    },
    updateCityArmyCell: function (cityId, type, $node) {
      var $row;
      var celllevel = !$node;
      try {
        if (celllevel) {
          $row = this.getArmyRow(cityId);
          $node = Utils.getClone($row);
        }
        var city = database.getCityFromId(cityId);
        var data1 = city.military.getUnits.getUnit(type) || 0;
        var data2 = city.military.getIncomingTotals[type] || 0;
        var data3 = city.military.getTrainingTotals[type] || 0;
        var cells = $node.find('td.' + type);
        cells.get(0).textContent = Utils.FormatNumToStr(data1, false, 0) || '';
        cells = cells.eq(1).children('span');
        cells.get(0).textContent = Utils.FormatNumToStr(data2, true, 0) || '';
        cells.get(1).textContent = Utils.FormatNumToStr(data3, true, 0) || '';
        delete this.cityRows.army[cityId];
        if (celllevel) {
          Utils.setClone($row, $node);
          this.setArmyTotals(undefined, type);
        }
      } catch (e) {
        empire.error('updateCityArmyCell', e);
      } finally {

      }
    },
    updateCityArmyRow: function (cityId, $node) {
      var $row;
      var rowLevel = !$node;
      if (rowLevel) {
        $row = this.getArmyRow(cityId);
        $node = Utils.getClone($row);
      }
      for (var armyId in Constant.UnitData) {
        this.updateCityArmyCell(cityId, armyId, $node);
      }
      if (rowLevel) {
        Utils.setClone($row, $node);
        this.setArmyTotals();
        delete this.cityRows.army[cityId];
      }
    },
    updateCitiesArmyData: function () {
      var $node = $('#ArmyTab').find('table.army');
      var $clone = Utils.getClone($node);
      for (var cityId in database.cities) {
        empire.time(this.updateCityArmyRow.bind(this, cityId, $clone.find('#army_' + cityId)), 'updateArmyRow');
      }
      this.setArmyTotals($clone);
      Utils.setClone($node, $clone);
      this.cityRows.army = {};
    },
    updateChangesForCityMilitary: function (cityId, changes) {
      if (changes && changes.length < 5) {
        $.each(changes, function (index, unit) {
          this.updateCityArmyCell(cityId, unit);
        }.bind(render));
        this.setArmyTotals();
      } else {
        this.updateCityArmyRow(cityId);
      }
    },
    updateGlobalData: function (changes) {
      this.setAllResourceData();
      return true;
    },
    updateMovementsForCity: function (changedCityIds) {
      if (changedCityIds.length)
        $.each(changedCityIds, function (index, id) {
          var city = database.getCityFromId(id);
          if (city) {
            this.setMovementDataForCity(city);
          }
        }.bind(render));
    },
    updateResourcesForCity: function (cityId, changes) {
      var city = database.getCityFromId(cityId);
      if (city) {
        events.scheduleAction(this.updateResourceCounters.bind(render, true), 0);
      }
    },
    updateCityDataForCity: function (cityId, changes) {
      var city = database.getCityFromId(cityId);
      if (city) {
        var research = 0, population = 0, finance = 0;
        for (var key in changes) {
          switch (key) {
            case 'research':
              research += changes[key];
              break;
            case 'priests':
              if (Constant.Government.THEOCRACY === database.getGovernmentType) {
                population += changes[key];
                finance += changes[key];
              }
              break;
            case 'culturalGoods':
              research += changes[key];
              population += changes[key];
              break;
            case 'citizens':
            case 'population':
              population += changes[key];
              finance += changes[key];
              break;
            case 'name':
              this.setCityName(city);
              break;
            case 'islandId':
              break;
            case 'coordinates':
              break;
            case 'finance':
              finance += changes[key];
          }
        }
        if (!!population) {
          this.setPopulationData(city);
        }
        if (!!research) {
          this.setResearchData(city);
        }
        if (!!finance) {
          this.setFinanceData(city);
        }
      }
    },
    setArmyTotals: function ($node, unitId) {
      var data = database.getArmyTotals;
      if (!$node) {
        $node = $('#ArmyTab');
      }
      if (unitId) {
        $node.find('td.total.' + unitId).eq(0).text(Utils.FormatNumToStr(data[unitId].total, false, 0) || '')
          .next().children('span').eq(0).text(Utils.FormatNumToStr(data[unitId].incoming, true, 0) || '')
          .next().text(Utils.FormatNumToStr(data[unitId].training, true, 0) || '');
        if (data[unitId].training || data[unitId].incoming || data[unitId].total || database.settings.fullArmyTable.value) {
          $node.find('td.' + unitId + ' ,th.' + unitId).show();
        } else {
          $node.find('td.' + unitId + ' ,th.' + unitId).hide();
        }
      } else {
        $.each(Constant.UnitData, function (unit, info) {
          $node.find('td.total.' + unit).eq(0).text(Utils.FormatNumToStr(data[unit].total, false, 0) || '')
            .next().children('span').eq(0).text(Utils.FormatNumToStr(data[unit].incoming, true, 0) || '')
            .next().text(Utils.FormatNumToStr(data[unit].training, true, 0) || '');
          if (data[unit].training || data[unit].incoming || data[unit].total || database.settings.fullArmyTable.value) {
            $node.find('td.' + unit + ' ,th.' + unit).show();
          } else {
            $node.find('td.' + unit + ' ,th.' + unit).hide();
          }
        });
      }
    },
    updateChangesForCityBuilding: function (cityID, changes) {
      try {
        var city = database.getCityFromId(cityID);
        if (city) {
          if (changes.length) {
            $.each(changes, function (key, data) {
              var building = city.getBuildingFromPosition(data.position);
              if (building.getName === data.name) {
                this.updateCityBuildingPosition(city, data.position);
              } else {
                this.updateCityBuildingRow(city);
                return false;
              }
            }.bind(render));
          }
        }
      } catch (e) {
        empire.error('updateChangesForCityBuilding', e);
      } finally {
      }
    },
    updateCityBuildingPosition: function (city, position, $node) {
      var building = city.getBuildingFromPosition(position);
      var idx = 0;
      //var cellOnly = ($node == undefined);
      var cellOnly = ($node === undefined);
      $.each(city.getBuildingsFromName(building.getName), function (index, b) {
        if (b.getPosition == building.getPosition) {
          idx = index;
          return false;
        }
      });
      var cell;
      if (cellOnly) {
        $node = render.getBuildingsRow(city);
        cell = $node.find('td.building.' + building.getName + idx);
      }
      else {
        cell = $node.find('td.building.' + building.getName + idx);
      }
      if (!building.isEmpty) {
        if (cell.length) {
          cell.html('<span>' + building.getLevel + '</span>').find('span')
            .removeClass('upgrading upgradable upgradableSoon maxLevel')
            .addClass('clickable')
            .addClass((building.isMaxLevel ? 'maxLevel' : '') + (building.isUpgrading ? ' upgrading' : '') + (building.isUpgradable ? (city.isUpgrading ? ' upgradableSoon' : ' upgradable') : ''));
        }
        else {
          return false;
        }
      }
      return true;
    },
    updateCityBuildingRow: function (city, $node) {
      try {
        var $row;
        var cellLevel = !$node;
        if (cellLevel) {
          $row = this.getBuildingsRow(city);
          $node = Utils.getClone($row);
        }
        var success = true;
        $.each(city.getBuildings, function (position, building) {
          success = this.updateCityBuildingPosition(city, position, $node);
          return success;
        }.bind(render));

        if (cellLevel) {
          render.cityRows.building[city.getId] = undefined;
          $node.find('table.buildings').html(render.getBuildingTable);

          if (!success) {
            render.updateCitiesBuildingData();
            $.each(database.cities, function (cityId, city) {
              render.setCityName(city);
              render.setActionPoints(city);
            });
            return success;
          }
          Utils.setClone($row, $node);
        }
        return success;
      } catch (e) {
        empire.error('updateCityBuildingRow', e);
      } finally {
      }
    },
    updateCitiesBuildingData: function ($redraw) {
      try {
        var success = true;
        var i = 0;
        var $node = $('#BuildTab').find('table.buildings');
        var $clone = $redraw || Utils.getClone($node);
        $.each(database.cities, function (cityId, city) {
          success = empire.time(this.updateCityBuildingRow.bind(this, city, $clone.find('#building_' + city.getId)), 'updateBuildingRow');
          return success;
        }.bind(render));
        if (!success) {
          $clone.html(render.getBuildingTable);
          if (!$redraw) {
            render.updateCitiesBuildingData($clone);
          }
        }
        if (!$redraw) {
          this.cityRows.building = {};
          Utils.setClone($node, $clone);
        }
        else {
          $.each(database.cities, function (cityId, city) {
            render.setCityName(city);
            render.setActionPoints(city);
          });
        }
      } catch (e) {
        empire.error('updateCitiesBuildingData', e);
      } finally {
      }
    },
    redrawSettings: function () {
      var $settingsTab = this._getCachedSelector('$settingsTab');
      $settingsTab.html(render.getSettingsTable());
      $("#empire_Reset_Button").button({ icons: { primary: "ui-icon-alert" }, text: true });
      $("#empire_Website_Button").button({ icons: { primary: "ui-icon-home" }, text: true });
      $("#empire_Update_Button").button({ icons: { primary: "ui-icon-info" }, text: true });
      $("#empire_Bug_Button").button({ icons: { primary: "ui-icon-notice" }, text: true });
      $("#empire_Save_Button").button({ icons: { primary: "ui-icon-check" }, text: true });
    },
    DrawContentBox: function () {
      var lang = database.settings.languageChange.value;
      var that = this;
      if (!this.mainContentBox) { //<li><a href="#WorldmapTab" data-tooltip="Not yet implemented">Worldmap</a></li>
        $("#container").after('<div id="empireBoard" class="ui-widget" style="display:none;z-index:' + (database.settings.onTop.value ? 65112 : 61) + ';position: absolute; left:70px;top:180px;">\
                                    <div id="empire_Tabs">\
                                        <ul>\
                                            <li><a href="#ResTab">'+ Constant.LanguageData[lang].economy + '</a></li>\
                                            <li><a href="#BuildTab">'+ Constant.LanguageData[lang].buildings + '</a></li>\
                                            <li><a href="#ArmyTab">'+ Constant.LanguageData[lang].military + '</a></li>\
                                            <li><a href="#SettingsTab" data-tooltip="'+ Constant.LanguageData[lang].options + '"><span class="ui-icon ui-icon-gear"/></a></li>\
											<li><a href="#HelpTab" data-tooltip="'+ Constant.LanguageData[lang].help + '"><span class="ui-icon ui-icon-help"/></a></li>\
                                        </ul>\
                                        <div id="ResTab"></div>\
                                        <div id="BuildTab"></div>\
                                        <div id="ArmyTab"></div>\
										<div id="WorldmapTab"></div>\
                                        <div id="SettingsTab"></div>\
                                        <div id="HelpTab"></div>\
                                    </div>\
                                </div>');
        this.mainContentBox = $("#empireBoard");
        this.$tabs = $("#empire_Tabs").tabs({ collapsible: true, show: null, selected: -1 });
        this.mainContentBox.draggable({
          handle: '#empire_Tabs > ul',
          cancel: 'div.ui-tabs-panel',
          stop: function () {
            render.SaveDisplayOptions();
          }
        });
        this.$tabs.find('ul li a').on('click', function () {
          events(Constant.Events.TAB_CHANGED).pub(render.$tabs.tabs('option', 'active'));
          render.SaveDisplayOptions();

        });
        render.mainContentBox.on('mouseenter', function () {
          if (database.settings.windowTennis.value) {
            render.mainContentBox.css('z-index', "65112");
          }
        }).on('mouseleave', function () {
          if (database.settings.windowTennis.value) {
            render.mainContentBox.css('z-index', "2");
          }
        });
      }
    },
    AttachClickHandlers: function () {
      $('body').on('click', '#js_buildingUpgradeButton', function (e) {
        var upgradeSuccessCheck;
        var href = this.getAttribute('href');
        if (href !== '#') {
          var params = $.decodeUrlParam(href);
          if (params['function'] === "upgradeBuilding") {
            upgradeSuccessCheck = (function upgradeSuccess() {
              var p = params;
              return function (response) {
                var len = response.length;
                var feedback = 0;
                while (len--) {
                  if (response[len][0] == 'provideFeedback') {
                    feedback = response[len][1][0].type;
                    break;
                  }
                }
                if (feedback == 10) { //success
                  render.updateChangesForCityBuilding(p.cityId || ikariam.getCurrentCity, []);
                }
                events('ajaxResponse').unsub(upgradeSuccessCheck);
              };
            })();
          }
          events('ajaxResponse').sub(upgradeSuccessCheck);
        }
      });
      render.mainContentBox.on('click', 'td.city_name span.clickable', function (event) {
        var target = $(event.target);
        var city = database.getCityFromId(target.parents('tr').attr('id').split('_').pop());
        var classes = target.parents('td').attr('class');
        var params = { cityId: city.getId };
        if (!city.isCurrentCity) {
          $("#js_cityIdOnChange").val(city.getId);
          if (unsafeWindow.ikariam.templateView) {
            if (unsafeWindow.ikariam.templateView.id === 'tradegood' || unsafeWindow.ikariam.templateView.id === 'resource') {
              params.templateView = unsafeWindow.ikariam.templateView.id;
              if (ikariam.viewIsCity) {
                params.islandId = city.getIslandID;
                params.view = unsafeWindow.ikariam.templateView.id;
                params.type = unsafeWindow.ikariam.templateView.id == 'resource' ? 'resource' : city.getTradeGoodID;
              } else {
                params.currentIslandId = ikariam.getCurrentCity.getIslandID;
              }
            }
          }
          ikariam.loadUrl(true, ikariam.mainView, params);
        }
        return false;
      }).on('click', 'td.empireactions div.transport', function (event) {
        var target = $(event.target);
        var city = database.getCityFromId(target.parents('td').parents('tr').attr('id').split('_').pop());
        if (!city.isCurrentCity && ikariam.getCurrentCity) {
          ikariam.loadUrl(true, ikariam.mainView, { view: 'transport', destinationCityId: city.getId, templateView: Constant.Buildings.TRADING_PORT });
        }
        return false;
      }).on('click', 'td.empireactions div[class*=deployment]', function (event) {
        var target = $(event.target);
        var city = database.getCityFromId(target.parents('tr').attr('id').split('_').pop());
        var type = target.attr('class').split(' ').pop().split('deployment').pop();
        if (ikariam.currentCityId === city.getId) {
          return false;
        }
        var params = {
          cityId: ikariam.CurrentCityId,
          view: 'deployment',
          deploymentType: type,
          destinationCityId: city.getId
        };
        ikariam.loadUrl(true, null, params);
      });
      $('#empire_Tabs').on('click', 'td.empireactions div.worldmap', function (event) {
        var target = $(event.target);
        var className = target.parents('td').attr('class').split(' ').pop();
        var city = database.getCityFromId(target.parents('tr').attr('id').split('_').pop());
        var params = {
          cityId: city.getId,
          view: 'worldmap_iso'
        };
        ikariam.loadUrl(true, 'city', params);
        return false;
      }).on('click', 'td.empireactions div.island', function (event) {
        var target = $(event.target);
        var className = target.parents('td').attr('class').split(' ').pop();
        var city = database.getCityFromId(target.parents('tr').attr('id').split('_').pop());
        var params = {
          cityId: city.getId,
          view: 'island'
        };
        ikariam.loadUrl(true, null, params);
        return false;
      }).on('click', 'td.empireactions div.city', function (event) {
        var target = $(event.target);
        var city = database.getCityFromId(target.parents('tr').attr('id').split('_').pop());
        var className = target.parents('td').attr('class').split(' ').pop();
        var building = city.getBuildingFromName(Constant.Buildings.TOWN_HALL);
        var params = building.getUrlParams;
        if (unsafeWindow.ikariam.templateView) unsafeWindow.ikariam.templateView.id = null;
        ikariam.loadUrl(true, 'city', params);
        return false;
      }).on('click', 'td.population_happiness', function (event) {
        var target = $(event.target);
        var city = database.getCityFromId(target.parents('tr').attr('id').split('_').pop());
        var className = target.parents('td').attr('class').split(' ').pop();
        var building = city.getBuildingFromName(Constant.Buildings.TAVERN);
        var params = building.getUrlParams;
        if (unsafeWindow.ikariam.templateView) unsafeWindow.ikariam.templateView.id = null;
        ikariam.loadUrl(true, 'city', params);
        return false;
      }).on('click', 'td.research span', function (event) {
        var target = $(event.target);
        var city = database.getCityFromId(target.parents('tr').attr('id').split('_').pop());
        var className = target.parents('td').attr('class').split(' ').pop();
        var building = city.getBuildingFromName(Constant.Buildings.ACADEMY);
        var params = building.getUrlParams;
        if (unsafeWindow.ikariam.templateView) unsafeWindow.ikariam.templateView.id = null;
        ikariam.loadUrl(true, 'city', params);
        return false;
      }).on('click', 'td.empireactions div.barracks', function (event) {
        var target = $(event.target);
        var city = database.getCityFromId(target.parents('tr').attr('id').split('_').pop());
        var className = target.parents('td').attr('class').split(' ').pop();
        var building = city.getBuildingFromName(Constant.Buildings.BARRACKS);
        var params = building.getUrlParams;
        if (unsafeWindow.ikariam.templateView) unsafeWindow.ikariam.templateView.id = null;
        ikariam.loadUrl(true, 'city', params);
        return false;
      }).on('click', 'td.empireactions div.shipyard', function (event) {
        var target = $(event.target);
        var city = database.getCityFromId(target.parents('tr').attr('id').split('_').pop());
        var className = target.parents('td').attr('class').split(' ').pop();
        var building = city.getBuildingFromName(Constant.Buildings.SHIPYARD);
        var params = building.getUrlParams;
        if (unsafeWindow.ikariam.templateView) unsafeWindow.ikariam.templateView.id = null;
        ikariam.loadUrl(true, 'city', params);
        return false;
      }).on('click', 'td.wonder', function (event) {
        var target = $(event.target);
        var city = database.getCityFromId(target.parents('tr').attr('id').split('_').pop());
        var className = target.parents('td').attr('class').split(' ').pop();
        var building = city.getBuildingFromName(Constant.Buildings.TEMPLE);
        var params = building.getUrlParams;
        if (unsafeWindow.ikariam.templateView) unsafeWindow.ikariam.templateView.id = null;
        ikariam.loadUrl(true, 'city', params);
        return false;
      }).on('click', 'th.empireactions div.spio', function () {
        ikariam.loadUrl(ikariam.viewIsCity, "city", ikariam.getCurrentCity.getBuildingFromName(Constant.Buildings.HIDEOUT).getUrlParams); //tabReports
      }).on('click', 'th.empireactions div.combat', function () {
        ikariam.loadUrl(ikariam.viewIsCity, "city", { view: 'militaryAdvisor', activeTab: 'combatReports' });
      }).on('click', 'span.production', function (event) {
        var target = $(event.target);
        var city = database.getCityFromId(target.parents('tr').attr('id').split('_').pop());
        var resource = target.parents('td').attr('class').split(' ').pop();
        var params = {
          cityId: city.getId
        };
        if (ikariam.CurrentCityId == city.getId || !ikariam.viewIsIsland) {
          params.type = resource == Constant.Resources.WOOD ? 'resource' : city.getTradeGoodID;
          params.view = resource == Constant.Resources.WOOD ? 'resource' : 'tradegood';
          params.islandId = city.getIslandID;
        } else if (ikariam.viewIsIsland) {
          params.templateView = resource == Constant.Resources.WOOD ? 'resource' : 'tradegood';
          if (unsafeWindow.ikariam.templateView) unsafeWindow.ikariam.templateView.id = null;
        }
        if (ikariam.viewIsIsland) {
          params.currentIslandId = ikariam.getCurrentCity.getIslandID;
        }
        ikariam.loadUrl(true, ikariam.mainView, params);
        render.AddIslandCSS();
        return false;
      }).on('click', 'td.empireactions div.islandgood', function (event) {
        var target = $(event.target);
        var city = database.getCityFromId(target.parents('tr').attr('id').split('_').pop());
        var resource = target.parents('td').attr('class').split(' ').pop();
        var params = {
          cityId: city.getId
        };
        if (ikariam.CurrentCityId == city.getId || !ikariam.viewIsIsland) {
          params.type = resource == Constant.Resources.WOOD ? 'resource' : city.getTradeGoodID;
          params.view = resource == Constant.Resources.WOOD ? 'resource' : 'tradegood';
          params.islandId = city.getIslandID;
        } else if (ikariam.viewIsIsland) {
          params.templateView = resource == Constant.Resources.WOOD ? 'resource' : 'tradegood';
          if (unsafeWindow.ikariam.templateView) unsafeWindow.ikariam.templateView.id = null;
        }
        if (ikariam.viewIsIsland) {
          params.currentIslandId = ikariam.getCurrentCity.getIslandID;
        }
        ikariam.loadUrl(true, ikariam.mainView, params);
        render.AddIslandCSS();
        return false;
      }).on('click', 'td.empireactions div.islandwood', function (event) {
        var target = $(event.target);
        var city = database.getCityFromId(target.parents('tr').attr('id').split('_').pop());
        var resource = target.parents('td').attr('class').split(' ').pop();
        var params = {
          cityId: city.getId
        };
        if (ikariam.CurrentCityId == city.getId || !ikariam.viewIsIsland) {
          params.type = resource == Constant.Resources.WOOD ? city.getTradeGoodID : 'resource';
          params.view = resource == Constant.Resources.WOOD ? 'tradegood' : 'resource';
          params.islandId = city.getIslandID;
        } else if (ikariam.viewIsIsland) {
          params.templateView = resource == Constant.Resources.WOOD ? 'resource' : 'tradegood';
          if (unsafeWindow.ikariam.templateView) unsafeWindow.ikariam.templateView.id = null;
        }
        if (ikariam.viewIsIsland) {
          params.currentIslandId = ikariam.getCurrentCity.getIslandID;
        }
        ikariam.loadUrl(true, ikariam.mainView, params);
        render.AddIslandCSS();
        return false;
      });
      $('#empire_Tabs').on('click', 'td.building span.clickable', function (event) {
        var target = $(event.target);
        var city = database.getCityFromId(target.parents('tr').attr('id').split('_').pop());
        var className = target.parents('td').attr('class').split(' ').pop();
        var building = city.getBuildingsFromName(className.slice(0, -1))[className.charAt(className.length - 1)];
        var params = building.getUrlParams;
        if (unsafeWindow.ikariam.templateView) unsafeWindow.ikariam.templateView.id = null;
        ikariam.loadUrl(true, 'city', params);
        return false;
      });
    },

    startResourceCounters: function () {
      this.stopResourceCounters();
      this.resUpd = events.scheduleActionAtInterval(render.updateResourceCounters.bind(render), 5000);
      this.updateResourceCounters(true);
    },
    stopResourceCounters: function () {
      if (this.resUpd) {
        this.resUpd();
        this.resUpd = null;
      }
    },
    getResourceRow: function (city) {
      return this._getRow(city, "resource");
    },
    getBuildingsRow: function (city) {
      return this._getRow(city, "building");
    },
    getArmyRow: function (city) {
      return this._getRow(city, "army");
    },
    _getRow: function (city, type) {
      city = typeof city == 'object' ? city : database.getCityFromId(city);
      if (!this.cityRows[type][city.getId])
        this.cityRows[type][city.getId] = $("#" + type + "_" + city.getId);
      return this.cityRows[type][city.getId];
    },
    getAllRowsForCity: function (city) {
      return this.getResourceRow(city).add(this.getBuildingsRow(city)).add(this.getArmyRow(city));
    },
    setCityName: function (city, rows) {
      if (!rows) {
        rows = this.getAllRowsForCity(city);
      }
      var lang = database.settings.languageChange.value;
      rows.find('td.city_name').each(function (index, elem) {
        elem.children[0].outerHTML = '<span class="icon ' + city.getTradeGood + 'Image"></span>';
        elem.children[1].textContent = city.getName;
        elem.children[2].textContent = ' ' + (city.getAvailableBuildings || '') + ' ';
        elem.children[2].setAttribute('data-tooltip', Constant.LanguageData[lang].free_ground);
      });
    },
    setActionPoints: function (city, rows) {
      if (!rows) {
        rows = this.getAllRowsForCity(city);
      }
      rows.find('span.ap').text(city.getAvailableActions + '/' + city.maxAP);
      rows.find('span.garrisonlimit img').attr('src', '/cdn/all/both/advisors/military/bang_soldier.png');
    },
    setFinanceData: function (city, row) {
      if (!row) {
        row = this.getResourceRow(city);
      }
    },
    setPopulationData: function (city, row) {
      if (!row) {
        row = this.getResourceRow(city);
      }
      var lang = database.settings.languageChange.value;
      var populationData = city.populationData;
      var popSpace = Math.floor(populationData.currentPop - populationData.maxPop);
      var popDiff = populationData.maxPop - populationData.currentPop;
      row.find('td.population span').get(0).textContent = Utils.FormatNumToStr(populationData.currentPop, false, 0) + '/' + Utils.FormatNumToStr(populationData.maxPop, false, 0);
      row.find('td.population span').get(1).textContent = (popSpace !== 0 ? Utils.FormatNumToStr(popSpace, true, 0) : '');
      var fillperc = 100 / populationData.maxPop * populationData.currentPop;
      row.find('td.population div.progressbarPop').find('div.ui-progressbar-value').width(fillperc + "%").removeClass("normal, warning, full").addClass((populationData.currentPop / populationData.maxPop == 1) ? "full" : (city._citizens < 300) ? "warning" : "normal");
      var img = '';
      if (populationData.growth < -1) {
        img = 'outraged';
      } else if (populationData.growth < 0) {
        img = 'sad';
      } else if (populationData.growth < 1) {
        img = 'neutral';
      } else if (populationData.growth < 6) {
        img = 'happy';
      } else {
        img = 'ecstatic';
      }
      row.find('td.population_happiness span img').attr('src', '/cdn/all/both/smilies/' + img + '_x25.png');
      row.find('span.growth').text(popDiff !== 0 ? Utils.FormatNumToStr(populationData.growth, true, 2) : '0' + Constant.LanguageData[lang].decimalPoint + '00');
      row.find('span.growth').removeClass('Red Green').addClass(populationData.happiness > 60 && popDiff === 0 ? 'Red' : populationData.happiness > 0 && populationData.happiness <= 60 && popDiff > 0 ? 'Green' : '');
    },
    setResearchData: function (city, row) {
      if (!row) {
        row = this.getResourceRow(city);
      }
      var researchData = researchData || city.research.researchData;
      row.find('td.research span').addClass('clickbar').get(0).textContent = Utils.FormatNumToStr(city.research.getResearch) > 0 ? Utils.FormatNumToStr(city.research.getResearch, true, 0) : city.iSci;
      var fillperc = (100 * researchData.scientists) / city.maxSci;
      row.find('td.research div.progressbarSci').find('div.ui-progressbar-value').width(fillperc + "%").removeClass('normal, full').addClass(researchData.scientists === 0 ? '' : city.maxSci - researchData.scientists > 0 ? 'normal' : 'full');
    },
    setMovementDataForCity: function (city, row) {
      if (!row) {
        row = this.getResourceRow(city);
      }
      var totalIncoming = { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0, gold: 0 };
      $.each(city.getIncomingResources, function (index, element) {
        for (var resourceName in Constant.Resources) {
          totalIncoming[Constant.Resources[resourceName]] += element.getResource(Constant.Resources[resourceName]);
        }
      });
      row.find('td.resource.wood').find('span.incoming').get(0).textContent = Utils.FormatNumToStr(totalIncoming[Constant.Resources.WOOD]) || '';
      row.find('td.resource.wine').find('span.incoming').get(0).textContent = Utils.FormatNumToStr(totalIncoming[Constant.Resources.WINE]) || '';
      row.find('td.resource.marble').find('span.incoming').get(0).textContent = Utils.FormatNumToStr(totalIncoming[Constant.Resources.MARBLE]) || '';
      row.find('td.resource.glass').find('span.incoming').get(0).textContent = Utils.FormatNumToStr(totalIncoming[Constant.Resources.GLASS]) || '';
      row.find('td.resource.sulfur').find('span.incoming').get(0).textContent = Utils.FormatNumToStr(totalIncoming[Constant.Resources.SULFUR]) || '';
      row.find('td.resource.gold').find('span.incoming').get(0).textContent = Utils.FormatNumToStr(totalIncoming[Constant.Resources.GOLD]) || '';
    },
    setAllResourceData: function () {
      this.startResourceCounters();
    },
    setCommonData: function () {
      $.each(database.cities, function (cityId, city) {
        this.setCityName(city);
        this.setActionPoints(city);
      }.bind(render));
    },
    updateResourceCounters: function (force) {
      try {
        if ((this.$tabs.tabs('option', 'active') === 0) || force) {
          var tot = { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 };
          var inc = { wood: 0, wine: 0, marble: 0, glass: 0, sulfur: 0 };
          var conWine = 0;
          var income = 0;
          var researchCost = 0;
          var researchTot = 0;
          var populationTot = 0;
          var populationMaxTot = 0;
          var growthTot = 0;
          var citygrowth = 0;
          var popDiffTot = 0;
          $.each(database.cities, function (cityId, city) {
            var $row = Utils.getClone(this.getResourceRow(city));
            if (force) {
              this.setFinanceData(city, $row);
              this.setPopulationData(city, $row);
              this.setResearchData(city, $row);
              this.setActionPoints(city, $row);
              this.setMovementDataForCity(city, $row);
            }
            income += Math.floor(city.getIncome);
            researchTot += city.research.getResearch;
            researchCost += Math.floor(city.getExpenses);
            populationTot += city._population;
            populationMaxTot += city.populationData.maxPop;
            citygrowth = Math.floor(city.populationData.maxPop - city._population > 0) ? city.populationData.growth : 0;
            growthTot += citygrowth;
            popDiffTot = Math.floor(populationMaxTot - populationTot);
            var storage = city.maxResourceCapacities;
            $.each(Constant.Resources, function (key, resourceName) {
              var lang = database.settings.languageChange.value;
              var currentResource = city.getResource(resourceName);
              var production = currentResource.getProduction * 3600;
              var current = currentResource.getCurrent;
              var consumption = resourceName == Constant.Resources.WINE ? currentResource.getConsumption : 0;
              inc[resourceName] += production;
              tot[resourceName] += current;
              conWine += consumption;
              var rescells = $row.find('td.resource.' + resourceName);
              rescells.find('span.current').addClass(resourceName == Constant.Resources.WOOD || city.getTradeGood == resourceName).get(0).textContent = (current ? Utils.FormatNumToStr(current, false, 0) : '0' + Constant.LanguageData[lang].decimalPoint + '00');
              if (resourceName !== Constant.Resources.GOLD)
                rescells.find('span.production').addClass('clickable').get(0).textContent = (production ? Utils.FormatNumToStr(production, true, 0) : '');
              if (resourceName === Constant.Resources.WINE) {
                rescells.find('span.consumption').get(0).textContent = (consumption ? Utils.FormatNumToStr(0 - consumption, true, 0) : '');
                var time = currentResource.getEmptyTime;
                time = time > 1 ? Math.floor(time) + (60 - new Date().getMinutes()) / 60 : 0;
                time *= 3600000;
                rescells.find('span.emptytime').removeClass('Red Green').addClass(time > database.settings.wineWarningTime.value * 3600000 ? 'Green' : 'Red').get(0).textContent = database.settings.wineWarningTime.value > 0 ? (Utils.FormatTimeLengthToStr(time, 2)) : '';
                if (time < database.settings.wineWarningTime.value * 3600000 && database.settings.wineWarning.value != 1)
                  render.toastAlert('!!! ' + Constant.LanguageData[lang].alert_wine + city._name + ' !!!');
              }
              if (resourceName === Constant.Resources.GOLD) {
                rescells.find('span.current').get(0).textContent = city.getIncome + city.getExpenses >= 0 ? Utils.FormatNumToStr(city.getIncome + city.getExpenses) : Utils.FormatNumToStr((city.getIncome + city.getExpenses), true);
                rescells.find('span.production').get(0).textContent = Utils.FormatNumToStr(city.getIncome, true, 0);
                rescells.find('span.consumption').get(0).textContent = city.getExpenses !== 0 ? Utils.FormatNumToStr(city.getExpenses, true, 0) : '';
              }
              var fillperc = (current / storage.capacity) * 100;
              rescells.find('div.progressbar').find('div.ui-progressbar-value').width(fillperc + "%").removeClass("normal warning almostfull full").addClass(fillperc > 90 ? fillperc > 96 ? "full" : "almostfull" : fillperc > 70 ? "warning" : "normal");
              var diffGold = Math.floor(city.getIncome + city.getExpenses);
              var fillpercG = 100 / (city.populationData.maxPop * 3) * diffGold;
              if (resourceName === Constant.Resources.GOLD) {
                rescells.find('div.progressbar').find('div.ui-progressbar-value').width(fillpercG + "%").removeClass("normal almostfull full fullGold").addClass(fillpercG > 50 ? fillpercG == 100 ? "fullGold" : "normal" : fillpercG > 25 ? "almostfull" : "full");
              }
              if (storage.safe > current) {
                rescells.find('span.safeImage').show();
              } else {
                rescells.find('span.safeImage').hide();
              }
              if (resourceName === Constant.Resources.GOLD) {
                rescells.find('span.safeImage').hide();
              }
            }.bind(render));
            Utils.setClone(this.getResourceRow(city), $row);
            this.cityRows.resource[city.getId] = null;
          }.bind(render));
          var lang = database.settings.languageChange.value;
          var expense = database.getGlobalData.finance.armyCost + database.getGlobalData.finance.armySupply + database.getGlobalData.finance.fleetCost + database.getGlobalData.finance.fleetSupply - researchCost;
          var sigmaIncome = income - expense;
          var currentGold = 0;
          currentGold = Utils.FormatNumToStr(database.getGlobalData.finance.currentGold);
          if ((database.settings.GoldShort.value == 1) && (database.getGlobalData.finance.currentGold > 10000))
            currentGold = Utils.FormatNumToStr(database.getGlobalData.finance.currentGold / 1000) + 'k';
          $("#t_currentgold").get(0).textContent = currentGold;
          $("#t_currentwood").get(0).textContent = Utils.FormatNumToStr(Math.round(tot[Constant.Resources.WOOD]), false);
          $("#t_currentwine").get(0).textContent = Utils.FormatNumToStr(Math.round(tot[Constant.Resources.WINE]), false);
          $("#t_currentmarble").get(0).textContent = Utils.FormatNumToStr(Math.round(tot[Constant.Resources.MARBLE]), false);
          $("#t_currentglass").get(0).textContent = Utils.FormatNumToStr(Math.round(tot[Constant.Resources.GLASS]), false);
          $("#t_currentsulfur").get(0).textContent = Utils.FormatNumToStr(Math.round(tot[Constant.Resources.SULFUR]), false);
          $("#t_goldincome").children('span').removeClass('Red Green').addClass(sigmaIncome >= 0 ? 'Green' : 'Red').eq(0).text(Utils.FormatNumToStr(sigmaIncome, true, 0)).siblings('span').eq(0).text(sigmaIncome > 0 ? '\u221E' : Utils.FormatTimeLengthToStr((database.getGlobalData.finance.currentGold / sigmaIncome) * 60 * 60 * 1000, true, 0));
          $("#t_woodincome").find('span').get(0).textContent = Utils.FormatNumToStr(Math.round(inc[Constant.Resources.WOOD]), true);
          $("#t_wineincome").children('span').eq(0).text(Utils.FormatNumToStr(Math.round(inc[Constant.Resources.WINE]), true)).siblings('span').eq(0).text('-' + Utils.FormatNumToStr(Math.round(conWine), false));
          $("#t_marbleincome").find('span').get(0).textContent = Utils.FormatNumToStr(Math.round(inc[Constant.Resources.MARBLE]), true);
          $("#t_glassincome").find('span').get(0).textContent = Utils.FormatNumToStr(Math.round(inc[Constant.Resources.GLASS]), true);
          $("#t_sulfurincome").find('span').get(0).textContent = Utils.FormatNumToStr(Math.round(inc[Constant.Resources.SULFUR]), true);
          $("#t_population").get(0).textContent = Utils.FormatNumToStr(Math.round(populationTot), false) + '(' + Utils.FormatNumToStr(Math.round(populationMaxTot), false) + ')';
          $("#t_growth").get(0).textContent = popDiffTot > 0 ? Utils.FormatNumToStr(growthTot, true, 2) : '0' + Constant.LanguageData[lang].decimalPoint + '00';
          $("#t_research").get(0).textContent = researchTot ? Utils.FormatNumToStr(researchTot, true, 0) : '0' + Constant.LanguageData[lang].decimalPoint + '00';
          tot = inc = null;
        }
      } catch (e) {
        empire.error('UpdateResourceCounters', e);
      }
    }
  };

  function getCityNameFromID(originCity, city) {
    var ret = '';
    try {
      ret = database.cities[parseInt(originCity)].getName;
    } catch (e) {
      ret = originCity;
    }
    return ret;
  }
  render.LoadCSS = function () {
    // CSS data moved to separate file to allow for easier editing.

    // Use generic loader to import cssScript resource and call its loadCss export.
    loadResourceModule('cssScript').then(function (cssModule) {
      try {
        if (cssModule && typeof cssModule.loadCss === 'function') {
          // The actual work is done in the cssModule's loadCss function.
          cssModule.loadCss(database, isChrome, Constant);
        } else {
          console.warn('css module has no loadCss export');
        }
      } catch (e) {
        empire.error('cssModule.loadCss', e);
      }
    }).catch(function (err) {
      empire.error('loadResourceModule(cssScript)', err);
    });
  }

  /**************************************************************************
  *  hourly Resources
  ***************************************************************************/

  // lazy-initialized ResourceProduction module; created when initResourceProduction() is called
  var ResourceProduction = null;

  function initResourceProduction() {
    if (ResourceProduction) return; // already initialized
    ResourceProduction = (function () {
      function addProd(position, value) {
        value = Math.floor(value);
        if (value > 0)
          $('span#rp' + position).css('color', 'green').text(Utils.FormatNumToStr(value, true));
        else if (value < 0)
          $('span#rp' + position).css('color', 'red').text(Utils.FormatNumToStr(value, true));
        else $('span#rp' + position).css('color', 'gray').text('+0');
      }
      function createSpan(n) {
        var ids = ['wood', 'wine', 'marble', 'glass', 'sulfur'];
        if ($('span#rp' + n).length === 0) {
          $('#cityResources li[id="resources_' + ids[n] + '"]').css({ 'line-height': 'normal', 'padding-top': '0px' }).append('<span id="rp' + n + '" class="resourceProduction"></span>');
        }
      }
      function repositionSpan(newTradegood) {
        var oldTradegood = unsafeWindow.ikariam.model.producedTradegood;
        if (newTradegood != oldTradegood) {
          if (oldTradegood > 1) {
            $('span#rp' + oldTradegood).remove();
          }
          createSpan(newTradegood);
        }
      }
      function updateProd() {
        addProd(0, unsafeWindow.ikariam.model.resourceProduction * 3600);
        if (unsafeWindow.ikariam.model.cityProducesWine) {
          addProd(1, unsafeWindow.ikariam.model.tradegoodProduction * 3600 - unsafeWindow.ikariam.model.wineSpendings);
        } else {
          addProd(1, -unsafeWindow.ikariam.model.wineSpendings);
          addProd(unsafeWindow.ikariam.model.producedTradegood, unsafeWindow.ikariam.model.tradegoodProduction * 3600);
        }
      }
      return { createSpan: createSpan, repositionSpan: repositionSpan, updateProd: updateProd };
    })();

    try {
      ResourceProduction.createSpan(0);
      ResourceProduction.createSpan(1);
      ResourceProduction.createSpan(2);
      ResourceProduction.createSpan(3);
      ResourceProduction.createSpan(4);
      ResourceProduction.updateProd();

      var model = unsafeWindow.ikariam && unsafeWindow.ikariam.model;
      if (model) {
        model.ResourceProduction_updateGlobalData = model.updateGlobalData;
        model.updateGlobalData = function (dataSet) {
          ResourceProduction.repositionSpan(dataSet.producedTradegood); 
          unsafeWindow.ikariam.model.ResourceProduction_updateGlobalData(dataSet); 
          ResourceProduction.updateProd();
        };
      } else {
        console.warn('initResourceProduction: ikariam.model not present when initializing');
      }
    } catch (e) {
      empire && empire.error ? empire.error('initResourceProduction', e) : console.error(e);
    }
  }

  /***********************************************************************************************************************
   * ikariam
   **********************************************************************************************************************/

  var ikariam = {
    _View: null,
    _Host: null,
    _ActionRequest: null,
    _Units: null,
    _BuildingsList: null,
    _AltBuildingsList: null,
    _Nationality: null,
    _GameVersion: null,
    _TemplateView: null,
    _currentCity: null,
    url: function () {
      return 'http://' + this.Host() + '/index.php';
    },
    get mainView() {
      return unsafeWindow.ikariam.backgroundView.id;
    },
    get boxViewParams() {
      if (unsafeWindow.ikariam.mainbox_x || unsafeWindow.ikariam.mainbox_y || unsafeWindow.ikariam.mainbox_z) {
        return {
          mainbox_x: unsafeWindow.ikariam.mainbox_x,
          mainbox_y: unsafeWindow.ikariam.mainbox_y,
          mainbox_z: unsafeWindow.ikariam.mainbox_z
        };
      }
      return {};
    },
    loadUrl: function (ajax, mainView, params) {
      mainView = mainView || ikariam.mainView;
      var paramList = { cityId: ikariam.CurrentCityId };
      if (ikariam.CurrentCityId !== params.cityId) {
        paramList.action = 'header';
        paramList.function = 'changeCurrentCity';
        // Prefer cached model; if actionRequest is not available synchronously,
        // wait for the model and then navigate. This avoids racing with model init.
        var model = getCachedModel();
        var doNavigate = function () {
          if (model && model.actionRequest) paramList.actionRequest = model.actionRequest;
          paramList.currentCityId = ikariam.CurrentCityId;
          paramList.oldView = ikariam.mainView;
          if (mainView !== undefined && mainView !== ikariam.mainView) {
            paramList.oldBackgroundView = ikariam.mainView;
            paramList.backgroundView = mainView;
            ajax = false;
          }
          $.extend(paramList, params);
          var url = '?' + $.map(paramList, function (value, key) { return key + '=' + value; }).join('&');
          if (ajax) {
            gotoAjaxURL(url);
          } else {
            gotoURL(ikariam.url() + url);
          }
        };
        if (!model || !model.actionRequest) {
          // wait for model and then navigate (fall back to navigating without actionRequest)
          return whenModelReady().then(function (m) {
            model = m || getCachedModel();
            doNavigate();
          }).catch(function () {
            // fallback: navigate anyway
            doNavigate();
          });
        }
        paramList.currentCityId = ikariam.CurrentCityId;
        paramList.oldView = ikariam.mainView;
      }
      // If we reached here, model/actionRequest already handled above, so perform navigation.
      if (mainView !== undefined && mainView !== ikariam.mainView) {
        paramList.oldBackgroundView = ikariam.mainView;
        paramList.backgroundView = mainView;
        ajax = false;
      }
      $.extend(paramList, params);
      if (ajax) {
        gotoAjaxURL('?' + $.map(paramList, function (value, key) { return key + '=' + value; }).join('&'));
      } else {
        gotoURL(ikariam.url() + '?' + $.map(paramList, function (value, key) { return key + '=' + value; }).join('&'));
      }
      function gotoURL(url) {
        window.location.assign(url);
      }
      function gotoAjaxURL(url) {
        document.location = 'javascript:ajaxHandlerCall(' + JSON.stringify(url) + '); void(0);';
      }
    },
    Host: function () {
      if (this._Host == null) {
        this._Host = '';
        this._Host = document.location.host;
      }
      return this._Host;
    },
    Server: function (host) {
      if (this._Server == null) {
        if (host == undefined) {
          host = this.Host();
        }
        this._Server = '';
        var parts = host.split('.');
        this._Server = parts[0].split('-')[0];
      }
      return this._Server;
    },
    Language: function (host) {
      if (this._Language == null) {
        if (host == undefined) {
          host = this.Host();
        }
        this._Language = '';
        var parts = host.split('.');
        this._Language = parts[0].split('-')[1];
      }
      if ((this._Language == 'us') || (this._Language == 'au') || (this._Language == 'hk') || (this._Language == 'tw') || (this._Language == 'il') || (this._Language == 'lt') || (this._Language == 'hu') || (this._Language == 'bg') || (this._Language == 'rs') || (this._Language == 'si') || (this._Language == 'sk') || (this._Language == 'dk') || (this._Language == 'fi') || (this._Language == 'ee') || (this._Language == 'se') || (this._Language == 'no')) {
        this._Language = 'en';
      }
      if ((this._Language == 've') || (this._Language == 'mx') || (this._Language == 'ar') || (this._Language == 'co') || (this._Language == 'cl') || (this._Language == 'pe')) {
        this._Language = 'es';
      }
      if (this._Language == 'br') {
        this._Language = 'pt';
      }
      if (this._Language == 'ae') {
        this._Language = 'ar';
      }
      if (this._Language == 'gr') {
        this._Language = 'el';
      }
      return this._Language;
    },
    Nationality: function (host) {
      if (this._Nationality == null) {
        if (host == undefined) {
          host = this.Host();
        }
        this._Nationality = '';
        var parts = host.split('.');
        this._Nationality = parts[0].split('-')[1];
      }
      return this._Nationality;
    },
    getNextWineTick: function (precision) {
      precision = precision || 1;
      if (precision == 1) {
        return 60 - new Date().getMinutes();
      } else {
        var secs = 3600 - (new Date().getMinutes() * 60) - new Date().getSeconds();
        var ret = Math.floor(secs / 60) + database.getGlobalData.getLocalisedString('minute') + ' ';
        ret += secs - (Math.floor(secs / 60) * 60) + database.getGlobalData.getLocalisedString('second');
        return ret;
      }
    },
    GameVersion: function () {
      if (this._GameVersion == null) {
        this._GameVersion = $('.version').text().split('v')[1];
      }
      return this._GameVersion;
    },
    get CurrentCityId() {
      try {
        var model = getCachedModel();
        var selectedId = null;
        if (model && model.relatedCityData && typeof model.relatedCityData.selectedCity !== 'undefined') {
          var sel = model.relatedCityData.selectedCity;
          if (model.relatedCityData[sel]) selectedId = model.relatedCityData[sel].id;
        }
        if (unsafeWindow.ikariam.backgroundView && unsafeWindow.ikariam.backgroundView.id === 'city') {
          return ikariam._currentCity || selectedId || null;
        }
        return selectedId || null;
      } catch (e) {
        return null;
      }
    },
    get viewIsCity() {
      return unsafeWindow.ikariam.backgroundView && unsafeWindow.ikariam.backgroundView.id === 'city';
    },
    get viewIsIsland() {
      return unsafeWindow.ikariam.backgroundView && unsafeWindow.ikariam.backgroundView.id === 'island';
    },
    get viewIsWorld() {
      return unsafeWindow.ikariam.backgroundView && unsafeWindow.ikariam.backgroundView.id === 'worldmap_iso';
    },
    get getCurrentCity() {
      return database.cities[ikariam.CurrentCityId];
    },
    get getCapital() {
      for (var c in database.cities) {
        if (database.cities[c].isCapital) {
          return database.cities[c];
        }
      }
      return false;
    },
    get CurrentTemplateView() {
      try {
        this._CurrentTemplateView = unsafeWindow.ikariam.templateView.id;
      } catch (e) {
        this._CurrentTemplateView = null;
      }
      return this._CurrentTemplateView;
    },
    getLocalizationStrings: function () {
      var localStrings = unsafeWindow.LocalizationStrings;
      if (!localStrings) {
        $('script').each(function (index, script) {
          var match = /LocalizationStrings = JSON.parse\('(.*)'\);/.exec(script.innerHTML);
          if (match) {
            localStrings = JSON.parse(match[1]);
            return false;
          }
        });
      }
      var local = $.extend({}, localStrings);
      $.extend(local, local.timeunits.short);
      delete local.warnings;
      delete local.timeunits;
      $.each(local, function (name, value) {
        database.getGlobalData.addLocalisedString(name.toLowerCase(), value);
      });
      local = null;
    },
    setupEventHandlers: function () {
      events('ajaxResponse').sub(function (response) {
        var view, html, data, template;
        var len = response.length;
        var oldCity = this._currentCity;
        while (len) {
          len--;
          switch (response[len][0]) {
            case 'updateGlobalData':
              this._currentCity = parseInt(response[len][1].backgroundData.id);
              var cityData = $.extend({}, response[len][1].backgroundData, response[len][1].headerData);
              events('updateCityData').pub(this.CurrentCityId, $.extend({}, cityData));
              events('updateBuildingData').pub(this.CurrentCityId, cityData.position);
              break;
            case 'changeView':
              view = response[len][1][0];
              html = response[len][1][1];
              break;
            case 'updateTemplateData':
              template = response[len][1];
              if (unsafeWindow.ikariam.templateView) {
                if (unsafeWindow.ikariam.templateView.id == 'researchAdvisor') {
                  view = unsafeWindow.ikariam.templateView.id;
                }
              }
              break;
            case 'updateBackgroundData':
              oldCity = this.CurrentCityId;
              this._currentCity = parseInt(response[len][1].id);
              events('updateCityData').pub(this._currentCity, $.extend(true, {}, unsafeWindow.dataSetForView, response[len][1]));
              events('updateBuildingData').pub(this._currentCity, response[len][1].position);
              break;
          }
        }
        this.parseViewData(view, html, template);
        if (oldCity !== this.CurrentCityId) {
          events('cityChanged').pub(this.CurrentCityId);
        }
      }.bind(ikariam));
      events('formSubmit').sub(function (form) {
        var formID = form.getAttribute('id');
        if (!ikariam[formID + 'Submitted']) return false;
        var formSubmission = (function formSubmit() {
          var data = ikariam[formID + 'Submitted']();
          return function formSubmitID(response) {
            var len = response.length;
            var feedback = 0;
            while (len) {
              len--;
              if (response[len][0] == 'provideFeedback')
                feedback = response[len][1][0].type;
            }
            if (feedback == 10)
              ikariam[formID + 'Submitted'](data);
            events('ajaxResponse').unsub(formSubmission);
          };
        })();
        events('ajaxResponse').sub(formSubmission);
      }.bind(ikariam));
      events(Constant.Events.CITYDATA_AVAILABLE).sub(ikariam.FetchAllTowns.bind(ikariam));
    },
    Init: function () {
      this.setupEventHandlers();
    },
    parseViewData: function (view, html, tData) {
      if (this.getCurrentCity) {
        switch (view) {
          case 'finances':
            this.parseFinances($('#finances').find('table.table01 tr').slice(2).children('td'));
            break;
          case Constant.Buildings.TOWN_HALL:
            this.parseTownHall(tData);
            break;
          case 'militaryAdvisor':
            this.parseMilitaryAdvisor(html, tData);
            break;
          case 'cityMilitary':
            this.parseCityMilitary();
            //this.parseMilitaryLocalization();
            break;
          case 'researchAdvisor':
            this.parseResearchAdvisor(tData);
            break;
          case Constant.Buildings.PALACE:
            this.parsePalace();
            break;
          case Constant.Buildings.ACADEMY:
            this.parseAcademy(tData);
            break;
          case 'culturalPossessions_assign':
            this.parseCulturalPossessions(html);
            break;
          case Constant.Buildings.MUSEUM:
            this.parseMuseum();
            break;
          case Constant.Buildings.TAVERN:
            this.parseTavern();
            break;
          case 'transport':
          case 'plunder':
            this.transportFormSubmitted();
            break;
          case Constant.Buildings.TEMPLE:
            this.parseTemple(tData);
            break;
          case Constant.Buildings.BARRACKS:
          case Constant.Buildings.SHIPYARD:
            this.parseBarracks(view, html, tData);
            break;
          case 'deployment':
          case 'plunder':
            this.parseMilitaryTransport();
            break;
          case 'premium':
            this.parsePremium(view, html, tData);
            break;
        }
      }
    },
    parsePalace: function () {
      //var governmentType = $('#formOfRuleContent').find('td.government_pic img').attr('src').slice(16, -8);
      //---mrfix---
      var cases = {
        '8eb243d68d7e1e7d57c4fbf4416663': 'demokratie',
        'a403727326be282fa7eb729718e05a': 'ikakratie',
        '1d4933352dedf6e0269ef0717ceaeb': 'aristokratie',
        'd23aed943dedf6449c9cff81b6a036': 'diktatur',
        'e7f322861f76c39e7e86bcfac97f71': 'nomokratie',
        'c07616e9e2b93844dddba80e389cc4': 'oligarchie',
        '8b39242f51982b91c8933bdbc6267e': 'technokratie',
        '4eede67db23c07f47e73c483a5f32c': 'theokratie'
      };
      var ttype = $('#formOfRuleContent').find('td.government_pic img').attr('src').slice(26, -4);
      var governmentType = cases[ttype] || 'ikakratie';
      //---mrfix---
      var changed = (database.getGlobalData.getGovernmentType != governmentType);
      database.getGlobalData.governmentType = governmentType;
      if (changed) events(Constant.Events.GLOBAL_UPDATED).pub({ type: 'government' });
      database.getGlobalData.addLocalisedString('Current form', $('#palace').find('div.contentBox01h h3.header').get(0).textContent);
      render.toast('Updated: ' + $('#palace').children(":first").text());
    },
    parseCulturalPossessions: function (html) {
      var allCulturalGoods = html.match(/iniValue\s:\s(\d*)/g);
      var changes = [];
      $.each(html.match(/goodscity_(\d*)/g), function (i) {
        var cityID = this.split('_')[1];
        var culturalGoods = parseInt(allCulturalGoods[i].split(' ').pop());
        var changed = (database.cities[cityID]._culturalGoods != culturalGoods);
        if (changed) {
          database.cities[cityID]._culturalGoods = culturalGoods;
          changes.push(cityID);
        }
      });
      if (changes.length) $.each(changes, function (idx, cityID) {
        events(Constant.Events.CITY_UPDATED).pub(cityID, { culturalGoods: true });
      });
      render.toast('Updated: ' + $('#culturalPossessions_assign > .header').text());
    },
    parseMuseum: function () {
      var changed;
      var regText = $('#val_culturalGoodsDeposit').parent().text().match(/(\d+)/g);
      if (regText.length == 2) {
        changed = ikariam.getCurrentCity.updateCulturalGoods(parseInt(regText[0]));
      }
      if (changed) events(Constant.Events.CITY_UPDATED).pub(ikariam.CurrentCityId, { culturalGoods: true });
      render.toast('Updated: ' + $('#tab_museum > div > h3').get(0).textContent);
    },
    parseTavern: function () {
    },
    resTransportObject: function () {
      return {
        id: null,
        wood: 0,
        wine: 0,
        marble: 0,
        glass: 0,
        sulfur: 0,
        gold: 0,
        targetCityId: 0,
        arrivalTime: 0,
        originCityId: 0,
        loadedTime: 0,
        mission: ''
      };
    },
    troopTransportObject: function () {
      return {
        id: null,
        troops: {},
        targetCityId: 0,
        arrivalTime: 0,
        originCityId: 0,
        returnTime: 0,
        mission: ''
      };
    },
    parseBarracks: function (view, html, tData) {
      var type = view == Constant.Buildings.BARRACKS ? 'army' : view == Constant.Buildings.SHIPYARD ? 'fleet' : false;
      var city = ikariam.getCurrentCity;
      var currentUnits = {};
      var i = 14;
      while (i--) {
        if (tData['js_barracksUnitUnitsAvailable' + (i - 1)]) {
          currentUnits[tData['js_barracksUnitClass' + (i - 1)]['class'].split(' ').pop()] = parseInt(tData['js_barracksUnitUnitsAvailable' + (i - 1)].text);
        }
      }
      var changes = city.military.updateUnits(currentUnits);
      var elem = $('#unitConstructionList');
      if (elem.length) {
        var tasks = [];
        tasks.push({
          units: parseUnits(elem.find('> .army_wrapper .army')),
          completionTime: parseTime($('#buildCountDown').text()),
          type: type
        });
        elem.find('div.constructionBlock').each(function () {
          tasks.push({
            units: parseUnits($(this).find('> .army_wrapper .army')),
            completionTime: parseTime($(this).find('h4 > span').text()),
            type: type
          });
        });
        changes = changes.concat(city.military.setTraining(tasks));
      }
      elem = null;
      if (changes.length) {
        events(Constant.Events.MILITARY_UPDATED).pub(city.getId, $.exclusive(changes));
      }
      function parseUnits(element) {
        var units = {};
        element.each(function () {
          units[Constant.unitIds[this.classList.toString().match(/(\d+)/g)]] = parseInt(this.nextElementSibling.textContent.match(/(\d+)/g));
        });
        return units;
      }
      function parseTime(timeText) {
        var completionTime = new Date();
        var server = ikariam.Nationality();
        completionTime.setSeconds(completionTime.getSeconds() + (timeText.match(/(\d+)s/) ? parseInt(timeText.match(/(\d+)s/)[1]) : 0));
        completionTime.setMinutes(completionTime.getMinutes() + (timeText.match(/(\d+)m/) ? parseInt(timeText.match(/(\d+)m/)[1]) : 0));
        completionTime.setHours(completionTime.getHours() + (timeText.match(/(\d+)h/) ? parseInt(timeText.match(/(\d+)h/)[1]) : 0));
        completionTime.setDate(completionTime.getDate() + (timeText.match(/(\d+)D/) ? parseInt(timeText.match(/(\d+)D/)[1]) : 0));
        switch (server) {
          case 'de':
            completionTime.setDate(completionTime.getDate() + (timeText.match(/(\d+)T/) ? parseInt(timeText.match(/(\d+)T/)[1]) : 0));
            break;
          case 'gr':
            completionTime.setDate(completionTime.getDate() + (timeText.match(/(\d+)M/) ? parseInt(timeText.match(/(\d+)M/)[1]) : 0));
            break;
          case 'fr':
            completionTime.setDate(completionTime.getDate() + (timeText.match(/(\d+)J/) ? parseInt(timeText.match(/(\d+)J/)[1]) : 0));
            break;
          case 'ro':
            completionTime.setDate(completionTime.getDate() + (timeText.match(/(\d+)Z/) ? parseInt(timeText.match(/(\d+)Z/)[1]) : 0));
            break;
          case 'it':
          case 'tr':
            completionTime.setDate(completionTime.getDate() + (timeText.match(/(\d+)G/) ? parseInt(timeText.match(/(\d+)G/)[1]) : 0));
            break;
          case 'ir':
          case 'ae':
            completionTime.setSeconds(completionTime.getSeconds() + (timeText.match(/(\d+)ث/) ? parseInt(timeText.match(/(\d+)ث/)[1]) : 0));
            completionTime.setMinutes(completionTime.getMinutes() + (timeText.match(/(\d+)د/) ? parseInt(timeText.match(/(\d+)د/)[1]) : 0));
            completionTime.setHours(completionTime.getHours() + (timeText.match(/(\d+)س/) ? parseInt(timeText.match(/(\d+)س/)[1]) : 0));
            completionTime.setDate(completionTime.getDate() + (timeText.match(/(\d+)ر/) ? parseInt(timeText.match(/(\d+)ر/)[1]) : 0));
            break;
        }
        return completionTime.getTime();
      }
      render.toast('Updated: ' + $('#js_mainBoxHeaderTitle').text());
    },
    /**
     * First call without data will parse the transportform, second call will add the forms data to the database
     */
    transportFormSubmitted: function (data) {
      try {
        if (!data) {
          var journeyTime = $('#journeyTime').text();
          var loadingTime = $('#loadingTime').text();
          var wood = parseInt($('#textfield_wood').val());
          var wine = parseInt($('#textfield_wine').val());
          var marble = parseInt($('#textfield_marble').val());
          var glass = parseInt($('#textfield_glass').val());
          var sulfur = parseInt($('#textfield_sulfur').val());
          var gold = '';
          var targetID = $('input[name=destinationCityId]').val();
          var ships = $('#transporterCount').val();
          var arrTime = new Date();
          var loadedTime = new Date();
          var server = ikariam.Nationality();

          arrTime.setSeconds(arrTime.getSeconds() + (journeyTime.match(/(\d+)s/) ? parseInt(journeyTime.match(/(\d+)s/)[1]) : 0));
          arrTime.setMinutes(arrTime.getMinutes() + (journeyTime.match(/(\d+)m/) ? parseInt(journeyTime.match(/(\d+)m/)[1]) : 0));
          arrTime.setHours(arrTime.getHours() + (journeyTime.match(/(\d+)h/) ? parseInt(journeyTime.match(/(\d+)h/)[1]) : 0));
          arrTime.setDate(arrTime.getDate() + (journeyTime.match(/(\d+)D/) ? parseInt(journeyTime.match(/(\d+)D/)[1]) : 0));
          if (server == 'de')
            arrTime.setDate(arrTime.getDate() + (journeyTime.match(/(\d+)T/) ? parseInt(journeyTime.match(/(\d+)T/)[1]) : 0));

          loadedTime.setSeconds(loadedTime.getSeconds() + (loadingTime.match(/(\d+)s/) ? parseInt(loadingTime.match(/(\d+)s/)[1]) : 0));
          loadedTime.setMinutes(loadedTime.getMinutes() + (loadingTime.match(/(\d+)m/) ? parseInt(loadingTime.match(/(\d+)m/)[1]) : 0));
          loadedTime.setHours(loadedTime.getHours() + (loadingTime.match(/(\d+)h/) ? parseInt(loadingTime.match(/(\d+)h/)[1]) : 0));
          loadedTime.setDate(loadedTime.getDate() + (loadingTime.match(/(\d+)D/) ? parseInt(loadingTime.match(/(\d+)D/)[1]) : 0));
          if (server == 'de')
            loadedTime.setDate(loadedTime.getDate() + (loadingTime.match(/(\d+)T/) ? parseInt(loadingTime.match(/(\d+)T/)[1]) : 0));

          return new Movement('XXX-' + arrTime.getTime(), this.CurrentCityId, targetID, arrTime.getTime() + loadedTime.getTime() - $.now(), 'transport', loadedTime.getTime(), { gold: gold || 0, wood: wood || 0, wine: wine || 0, marble: marble || 0, glass: glass || 0, sulfur: sulfur || 0 }, undefined, ships);
        } else {
          database.getGlobalData.addFleetMovement(data);
          events(Constant.Events.MOVEMENTS_UPDATED).pub([data.getTargetCityId]);
        }
      } catch (e) {
        empire.error('transportFormSubmitted', e);
      } finally {
      }
    },
    parseMilitaryTransport: function (submit) {
      //return false;
      submit = submit || false;
      var that = this;
      if (submit) {
        var journeyTime = $('#journeyTime').text();
        var returnTime = $('#returnTime').text();
        var targetID = $('input:[name=destinationCityId]').val();
        var troops = {};
        var mission = '';
        $('ul.assignUnits li input.textfield').each(function () {
          if (this.value !== 0) {
            troops[this.getAttribute('name').split('_').pop()] = parseInt(this.value);
          }
          if (mission === '') {
            mission = 'deploy' + this.getAttribute('name').match(/_(.*)_/)[1];
          } else {
            mission = 'plunder' + this.getAttribute('name').match(/_(.*)_/)[1];
          }
        });
        var arrTime = new Date();
        var transport = this.troopTransportObject();
        var server = ikariam.Nationality();
        transport.id = 'XXX-' + arrTime.getTime();
        transport.targetCityId = targetID;
        transport.originCityId = this.CurrentCityId;
        transport.mission = mission;
        transport.troops = troops;
        arrTime.setSeconds(arrTime.getSeconds() + (journeyTime.match(/(\d+)s/) ? parseInt(journeyTime.match(/(\d+)s/)[1]) : 0));
        arrTime.setMinutes(arrTime.getMinutes() + (journeyTime.match(/(\d+)m/) ? parseInt(journeyTime.match(/(\d+)m/)[1]) : 0));
        arrTime.setHours(arrTime.getHours() + (journeyTime.match(/(\d+)h/) ? parseInt(journeyTime.match(/(\d+)h/)[1]) : 0));
        arrTime.setDate(arrTime.getDate() + (journeyTime.match(/(\d+)D/) ? parseInt(journeyTime.match(/(\d+)D/)[1]) : 0));
        if (server == 'de')
          arrTime.setDate(arrTime.getDate() + (journeyTime.match(/(\d+)T/) ? parseInt(journeyTime.match(/(\d+)T/)[1]) : 0));
        transport.arrivalTime = arrTime.getTime();
        arrTime = new Date();
        arrTime.setSeconds(arrTime.getSeconds() + (returnTime.match(/(\d+)s/) ? parseInt(returnTime.match(/(\d+)s/)[1]) : 0));
        arrTime.setMinutes(arrTime.getMinutes() + (returnTime.match(/(\d+)m/) ? parseInt(returnTime.match(/(\d+)m/)[1]) : 0));
        arrTime.setHours(arrTime.getHours() + (returnTime.match(/(\d+)h/) ? parseInt(returnTime.match(/(\d+)h/)[1]) : 0));
        arrTime.setDate(arrTime.getDate() + (returnTime.match(/(\d+)D/) ? parseInt(returnTime.match(/(\d+)D/)[1]) : 0));
        if (server == 'de')
          arrTime.setDate(arrTime.getDate() + (returnTime.match(/(\d+)T/) ? parseInt(returnTime.match(/(\d+)T/)[1]) : 0));
        transport.returnTime = arrTime.getTime();
        database.getGlobalData.addFleetMovement(transport);
        render.toast('Updated: Movement added');
        return false;
      } else {
        return true;
      }
    },
    parseFinances: function ($elem) {
      var updateTime = $.now();
      var changed;
      for (var i = 1; i < database.getCityCount + 1; i++) {
        var city = database.cities[Object.keys(database.cities)[i - 1]];
        if (city !== false) {
          changed = city.updateIncome(parseInt($elem[(i * 4) - 3].textContent.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join('')));
          changed = city.updateExpenses(parseInt($elem[(i * 4) - 2].textContent.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''))) || changed;
        }
        if (changed) events(Constant.Events.CITY_UPDATED).pub(city.getId, { finances: true });
      }
      var $breakdown = $('#finances').find('tbody tr.bottomLine td:last-child');
      database.getGlobalData.finance.armyCost = parseInt($breakdown[0].textContent.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
      database.getGlobalData.finance.fleetCost = parseInt($breakdown[1].textContent.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
      database.getGlobalData.finance.armySupply = parseInt($breakdown[2].textContent.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
      database.getGlobalData.finance.fleetSupply = parseInt($breakdown[3].textContent.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
      events('globalData').pub({ finances: true });
      database.getGlobalData.addLocalisedString('finances', $('#finances').find('h3#js_mainBoxHeaderTitle').text());
      render.toast('Updated: ' + $('#finances').children(":first").text());
    },
    parseResearchAdvisor: function (data) {
      var changes = [];
      var research = JSON.parse(data.new_js_params || data.load_js.params).currResearchType;
      $.each(research, function (name, Data) {
        var id = parseInt(Data.aHref.match(/researchId=([0-9]+)/i)[1]);
        var level = name.match(/\((\d+)\)/);
        var explored = level ? parseInt(level[1]) - 1 : (Data.liClass === 'explored' ? 1 : 0);
        var changed = database.getGlobalData.updateResearchTopic(id, explored);
        if (changed) changes.push({ type: 'research_topic', subType: id });
        database.getGlobalData.addLocalisedString('research_' + id, name.split('(').shift());
      });
      if (changes.length) events(Constant.Events.GLOBAL_UPDATED).pub(changes);
      database.getGlobalData.addLocalisedString('researchpoints', $('li.points').text().split(':')[0]);
      render.toast('Updated: ' + $('#tab_researchAdvisor').children(":first").text());
    },
    parseAcademy: function (data) {
      var city = ikariam.getCurrentCity;
      var changed = city.updateResearchers(parseInt(data.js_AcademySlider.slider.ini_value));
      if (changed)
        events(Constant.Events.CITY_UPDATED).pub(ikariam.CurrentCityId, { research: changed });
      render.toast('Updated: ' + $('#academy h3#js_mainBoxHeaderTitle').text() + '');
    },
    parseTownHall: function (data) {
      var changes = {};
      var city = ikariam.getCurrentCity;
      var cultBon = parseInt(data.js_TownHallSatisfactionOverviewCultureBoniTreatyBonusValue.text) || 0;
      var priests = parseInt(data.js_TownHallPopulationGraphPriestCount.text.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join('')) || 0;
      var researchers = parseInt(data.js_TownHallPopulationGraphScientistCount.text) || 0;
      changes.culturalGoods = city.updateCulturalGoods(cultBon / 50);
      changes.priests = city.updatePriests(priests);
      changes.research = city.updateResearchers(researchers);
      events(Constant.Events.CITY_UPDATED).pub(ikariam.CurrentCityId, changes);
      render.toast('Updated: ' + $('#js_TownHallCityName').text() + '');
    },
    parseTemple: function (data) {
      var priests = parseInt(data.js_TempleSlider.slider.ini_value) || 0;
      var changed = ikariam.getCurrentCity.updatePriests(priests);
      events(Constant.Events.CITY_UPDATED).pub(ikariam.CurrentCityId, { priests: changed });
    },
    parseMilitaryAdvisor: function (html, data) {
      try {
        var ownMovementIds = [];
        var move;
        for (var key in data) {
          var match = key.match(/^js_MilitaryMovementsEventRow(\d+)$/);
          if (match && Utils.existsIn(data[key]['class'], 'own')) {
            ownMovementIds.push(match[1]);
          }
        }
        var changes = database.getGlobalData.clearFleetMovements();
        if (ownMovementIds.length) {
          $.each(ownMovementIds, function (idx, value) {
            var transport = new Movement(value);
            var targetAvatar = '';
            transport._id = parseInt(value);
            transport._arrivalTime = parseInt(data['js_MilitaryMovementsEventRow' + value + 'ArrivalTime'].countdown.enddate * 1000);
            transport._loadingTime = 0;
            transport._originCityId = parseInt(data['js_MilitaryMovementsEventRow' + value + 'OriginLink'].href.match(/cityId=(\d+)/)[1]);
            transport._targetCityId = parseInt(data['js_MilitaryMovementsEventRow' + value + 'TargetLink'].href.match(/cityId=(\d+)/)[1]);
            transport._mission = data['js_MilitaryMovementsEventRow' + value + 'MissionIcon']['class'].split(' ')[1];
            var status = data['js_MilitaryMovementsEventRow' + value + 'Mission']['class'];
            if (status) {
              if (Utils.existsIn(status, 'arrow_left_green')) {
                var t = transport._originCityId;
                transport._originCityId = transport._targetCityId;
                transport._targetCityId = t;
              }
            } else {
              var serverTyp = 1;
              if (ikariam.Server() == 's201' || ikariam.Server() == 's202') serverTyp = 3;
              transport._loadingTime = transport._arrivalTime;
              if (database.getCityFromId(transport._originCityId) && database.getCityFromId(transport._targetCityId)) {
                transport._arrivalTime += Utils.estimateTravelTime(database.getCityFromId(transport._originCityId).getCoordinates, database.getCityFromId(transport._targetCityId).getCoordinates) / serverTyp;
              }
            }
            switch (transport._mission) {
              case 'trade':
              case 'transport':
              case 'plunder':
                $.each(data['js_MilitaryMovementsEventRow' + value + 'UnitDetails'].appendElement, function (index, item) {
                  if (Utils.existsIn(item['class'], Constant.Resources.WOOD)) {
                    transport._resources.wood = parseInt(item.text.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
                  } else if (Utils.existsIn(item['class'], Constant.Resources.WINE)) {
                    transport._resources.wine = parseInt(item.text.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
                  } else if (Utils.existsIn(item['class'], Constant.Resources.MARBLE)) {
                    transport._resources.marble = parseInt(item.text.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
                  } else if (Utils.existsIn(item['class'], Constant.Resources.GLASS)) {
                    transport._resources.glass = parseInt(item.text.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
                  } else if (Utils.existsIn(item['class'], Constant.Resources.SULFUR)) {
                    transport._resources.sulfur = parseInt(item.text.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
                  } else if (Utils.existsIn(item['class'], Constant.Resources.GOLD)) {
                    transport._resources.gold = parseInt(item.text.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
                  }
                });
                break;
              case 'deployarmy':
              case 'deployfleet':
              case 'plunder':
                transport._military = new MilitaryUnits();
                $.each(data['js_MilitaryMovementsEventRow' + value + 'UnitDetails'].appendElement, function (index, item) {
                  $.each(Constant.UnitData, function findIsUnit(val, info) {
                    if (Utils.existsIn(item['class'], ' ' + val)) {
                      transport._military.setUnit(val, parseInt(item.text));
                      return false;
                    }
                  });
                });
                break;
              default:
                return true;
            }
            database.getGlobalData.addFleetMovement(transport);
            changes.push(transport._targetCityId);
          });
        }
        if (changes.length) events(Constant.Events.MOVEMENTS_UPDATED).pub($.exclusive(changes));
      } catch (e) {
        empire.error('parseMilitaryAdvisor', e);
      } finally {
      }
      render.toast('Updated: ' + $('#js_MilitaryMovementsFleetMovements h3').text());
    },
    parseCityMilitary: function () {
      try {
        var $elemArmy = $('#tabUnits').find('> div.contentBox01h td');
        var $elemShips = $('#tabShips').find('> div.contentBox01h td');
        var city = ikariam.getCurrentCity;
        var cityArmy = {};
        cityArmy[Constant.Military.SLINGER] = parseInt($elemArmy[5].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.SWORDSMAN] = parseInt($elemArmy[4].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.HOPLITE] = parseInt($elemArmy[1].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.MARKSMAN] = parseInt($elemArmy[7].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.MORTAR] = parseInt($elemArmy[11].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.CATAPULT] = parseInt($elemArmy[10].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.RAM] = parseInt($elemArmy[8].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.STEAM_GIANT] = parseInt($elemArmy[2].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.BALLOON_BOMBADIER] = parseInt($elemArmy[13].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.COOK] = parseInt($elemArmy[14].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.DOCTOR] = parseInt($elemArmy[15].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.GYROCOPTER] = parseInt($elemArmy[12].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.ARCHER] = parseInt($elemArmy[6].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.SPEARMAN] = parseInt($elemArmy[3].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.SPARTAN] = parseInt($elemArmy[16].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));

        cityArmy[Constant.Military.RAM_SHIP] = parseInt($elemShips[3].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.FLAME_THROWER] = parseInt($elemShips[1].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.SUBMARINE] = parseInt($elemShips[8].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.BALLISTA_SHIP] = parseInt($elemShips[4].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.CATAPULT_SHIP] = parseInt($elemShips[5].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.MORTAR_SHIP] = parseInt($elemShips[6].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.STEAM_RAM] = parseInt($elemShips[2].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.ROCKET_SHIP] = parseInt($elemShips[7].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.PADDLE_SPEEDBOAT] = parseInt($elemShips[10].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.BALLOON_CARRIER] = parseInt($elemShips[11].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        cityArmy[Constant.Military.TENDER] = parseInt($elemShips[12].innerHTML.split(database.getGlobalData.getLocalisedString('thousandSeperator')).join(''));
        var changes = city.military.updateUnits(cityArmy);
        $elemArmy = null;
        $elemShips = null;
        events(Constant.Events.MILITARY_UPDATED).pub(city.getId, changes);

      } catch (e) {
        empire.error('parseCityMilitary', e);
      } finally {
      }
    },
    parsePremium: function (view, html, tData) {
      var changes = [];
      var features = [];
      $('#premiumOffers').find('table.table01 tbody > tr[class]:not([class=""])')
        .each(function () {
          var item = $(this).attr('class').split(' ').shift();
          if (Constant.PremiumData[item] !== undefined) {
            features.push(item);
          }
        });
      $.each(features, function (index, val) {
        var active = false;
        var endTime = 0;
        var continuous = false;
        var type = 0;
        active = $('#js_buy' + val + 'ActiveTime').hasClass('green');
        if (active) {
          endTime = parseInt($('#js_buy' + val + 'Link').attr('href').split('typeUntil=').pop().split('&').shift()) - Constant.PremiumData[val].duration;
          if (isNaN(endTime)) {
            var str = $('#js_buy' + val + 'ActiveTime').text();
            var time = new Date();
            time.setSeconds(time.getSeconds() + (str.match(/(\d+)s/) ? parseInt(str.match(/(\d+)s/)[1]) : 0));
            time.setMinutes(time.getMinutes() + (str.match(/(\d+)m/) ? parseInt(str.match(/(\d+)m/)[1]) : 0));
            time.setHours(time.getHours() + (str.match(/(\d+)h/) ? parseInt(str.match(/(\d+)h/)[1]) : 0));
            time.setDate(time.getDate() + (str.match(/(\d+)D/) ? parseInt(str.match(/(\d+)D/)[1]) : 0));
            endTime = time.getTime() / 1000;
          }
          type = parseInt($('#js_buy' + val + 'Link').attr('href').split('type=').pop().split('&').shift());
          continuous = $('#empireViewExtendCheckbox' + type + 'Img').hasClass('checked');
        }
        changes.push(database.getGlobalData.setPremiumFeature(val, endTime * 1000, continuous));
      });
      events(Constant.Events.PREMIUM_UPDATED).pub(changes);
      render.toast('Updated: ' + $('#premium').children(":first").text());
    },
    FetchAllTowns: function () {
      // run the original FetchAllTowns logic once the model is available
      var run = function (model) {
        try {
          var _relatedCityData = unsafeWindow.ikariam.model.relatedCityData;
          var _cityId = null;
          var city = null;
          var order = database.settings.cityOrder.value;
          if (!order.length) order = [];
          if (_relatedCityData) {
            for (_cityId in _relatedCityData) {
              if (_cityId != 'selectedCity' && _cityId != 'additionalInfo') {
                var own = (_relatedCityData[_cityId].relationship == 'ownCity');
                var deployed = (_relatedCityData[_cityId].relationship == 'deployedCities');
                var occupied = (_relatedCityData[_cityId].relationship == 'occupiedCities');
                if (own) {
                  if (database.cities[_relatedCityData[_cityId].id] == undefined) {
                    (database.cities[_relatedCityData[_cityId].id] = database.addCity(_relatedCityData[_cityId].id)).init();
                    city = database.cities[_relatedCityData[_cityId].id];
                    city.updateTradeGoodID(parseInt(_relatedCityData[_cityId].tradegood));
                    city.isOwn = own;
                  }
                  city = database.cities[_relatedCityData[_cityId].id];
                  city.updateName(_relatedCityData[_cityId].name);
                  var coords = _relatedCityData[_cityId].coords.match(/(\d+)/);
                  city.updateCoordinates(coords[0], coords[1]);
                  if ($.inArray(city.getId, order) == -1) {
                    order.push(city.getId);
                  }
                }
              }
            }
            //remove deleted cities
            for (var cID in database.cities) {
              var ghost = true;
              for (_cityId in _relatedCityData) {
                if (_relatedCityData[_cityId].id == cID || !database.cities[cID].isOwn) {
                  ghost = false;
                }
              }
              if (ghost) {
                delete database.cities[cID];
              }
            }
          }
          database.settings.cityOrder.value = order;
        } catch (e) {
          empire && empire.error ? empire.error('FetchAllTowns', e) : console.error(e);
        }
      };

      var model = getCachedModel();
      if (model) {
        run(model);
      } else {
        whenModelReady(function (m) { run(m || getCachedModel()); }).catch(function (err) {
          console.warn('FetchAllTowns: waitForIkariamModel failed, attempting run anyway', err);
          run(getCachedModel());
        });
      }
    },

    get currentShips() {
      if (this.$freeTransporters == undefined) {
        this.$freeTransporters = $('#js_GlobalMenu_freeTransporters');
      }
      return parseInt(this.$freeTransporters.text());
    }
  };

  /***********************************************************************************************************************
   * Constants
   **********************************************************************************************************************/
  // Constant will be populated asynchronously by loading the programDataScript resource.
  var Constant = null;
  // Promise that resolves when Constant is available.
  var ConstantReady = loadResourceModule('programDataScript')
    .then(function (dataModule) {
      // loadResourceModule already calls module.init if present.
      if (dataModule && typeof dataModule.getProgramData === 'function') {
        return dataModule.getProgramData();
      } else if (dataModule && typeof dataModule.default === 'function') {
        return dataModule.default();
      }
      throw new Error('programData module does not export getProgramData/default');
    })
    .then(function (data) {
      Constant = data;
      return data;
    })
    .catch(function (err) {
      empire.error('loadResourceModule(programDataScript)', err);
      throw err;
    });

  /***********************************************************************************************************************
   * Main Init
   **********************************************************************************************************************/
  if (debug) {
    delete unsafeWindow.console;
    unsafeWindow.empire = {
      s: empire,
      db: database,
      ikariam: ikariam,
      render: render,
      events: events,
      utils: Utils,
      Constant: Constant,
      $: $,
      get tip() { return $('.breakdown_table').text().replace(/\s\s/g, ' ').replace(/\s\s/g, ' ').replace(/\s\s/g, ' ').replace(/\s\s/g, ' ').replace(/\s\s/g, ' ').replace(/\s\s/g, ' ').replace(/\s\s/g, ' ').replace(/\s\s/g, ' ').replace(/\s\s/g, ' ').replace(/\s\s/g, ' ').replace(/\s\s/g, ' ').replace(/\s\s/g, ' '); }
    };
  }

  function empire_DomInit() {
    var bgViewId = $('body').attr('id');
    if (!(bgViewId === 'city' || bgViewId === 'island' || bgViewId === 'worldmap_iso' || !$('backupLockTimer').length)) {
      return false;
    }

    (function init(model, data, local, ajax) {
      var mod, dat, loc, aj;
      mod = !!unsafeWindow.ikariam && !!unsafeWindow.ikariam.model;
      dat = !!unsafeWindow.ikariam && !!unsafeWindow.ikariam.model.relatedCityData;
      loc = !!unsafeWindow.LocalizationStrings;
      aj = !!unsafeWindow.ikariam.controller && !!unsafeWindow.ikariam.controller.executeAjaxRequest && !!unsafeWindow.ajaxHandlerCallFromForm;
      if (dat && !data) {
        events(Constant.Events.CITYDATA_AVAILABLE).pub();
      }
      if (mod && dat && !model && !data) {
        events(Constant.Events.MODEL_AVAILABLE).pub();
      }
      if (loc && !local) {
        events(Constant.Events.LOCAL_STRINGS_AVAILABLE).pub();
      }
      if (aj && !ajax) {
        unsafeWindow.ajaxHandlerCallFromForm = function (ajaxHandlerCallFromForm) {
          return function cAjaxHandlerCallFromForm(form) {
            events('formSubmit').pub(form);
            return ajaxHandlerCallFromForm.apply(this, arguments);
          };
        }(unsafeWindow.ajaxHandlerCallFromForm);

        unsafeWindow.ikariam.controller.executeAjaxRequest = function (execAjaxRequest) {
          return function cExecuteAjaxRequest() {
            var args = $.makeArray(arguments);
            args.push(undefined);
            if (!args[1]) {
              args[1] = function customAjaxCallback(responseText) {
                var responder = unsafeWindow.ikariam.getClass(unsafeWindow.ajax.Responder, responseText);
                unsafeWindow.ikariam.controller.ajaxResponder = responder;
                events('ajaxResponse').pub(responder.responseArray);
                unsafeWindow.response = responder;
              };
            }
            var ret = execAjaxRequest.apply(this, args);
          };
        }(unsafeWindow.ikariam.controller.executeAjaxRequest);
      }
      if (!(mod && loc && dat && aj)) {
        events.scheduleAction(init.bind(null, mod, loc, dat, aj), 1000);
      }
      else {
        var initialAjax = [];
        $('script').each(function (index, script) {
          var match = /ikariam.getClass\(ajax.Responder, (.*)\);/.exec(script.innerHTML);
          if (match) {
            events('ajaxResponse').pub(JSON.parse(match[1] || []));
            return false;
          }
        });
      }
    })();
  };

  // Wait for shared helper (provided via @require) if available, otherwise initialize immediately.
  $(function () {
    // Centralized startup: wait once for both Constant (program data) and the ikariam model,
    // then initialize. This avoids duplicate waits/requests and ensures dependent code runs
    // only after both prerequisites are available.
    (async function startupOnce() {
      try {
        // Wait for both program data module and ikariam.model readiness.
        await Promise.all([
          ConstantReady,
          // whenModelReady is the local helper (polls if necessary). Use it to wait once.
          whenModelReady()
        ]);
      } catch (err) {
        // If either failed, log and still attempt initialization — errors will be handled
        // in the Init functions. This keeps behavior explicit and avoids silent failures.
        console.error('Empire Overview initialization: waiting for Constant or model failed', err);
      }
      try { empire.Init(); } catch (e) { empire.error('Init', e); }
      try { empire_DomInit(); } catch (e) { empire.error('DomInit', e); }
    })();
  });

  /**************************************************************************
  * for IkaLogs
  ***************************************************************************/

  // function addScript(src) {
  //   var scr = document.createElement('script');
  //   scr.type = 'text/javascript';
  //   scr.src = src;
  //   document.getElementsByTagName('body')[0].appendChild(scr);
  // }
})(jQuery);
